import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/queue/redis-client';

// ---------------------------------------------------------------------------
// POST /api/auth/request-otp
//
// Step 1 of the Telegram 2FA flow.
// Validates the master password using a timing-safe byte-level comparison to
// prevent timing-oracle attacks. On success: generates a 6-digit OTP, stores
// it in Redis with a 3-minute TTL, and dispatches it to the admin Telegram
// chat (CHAT_ID 8568627389).
//
// The OTP is scoped to a per-request nonce (auth:otp:<nonce>) to prevent
// race conditions where a concurrent call overwrites the OTP before
// verify-otp can consume it. The nonce is returned to the client and must
// be echoed back on verify-otp.
// ---------------------------------------------------------------------------

const OTP_KEY_PREFIX  = 'auth:otp:';
const OTP_TTL_SECONDS = 180; // 3 minutes
const TELEGRAM_CHAT_ID = '8568627389';

function generateOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, '0');
}

function generateNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  // Pad both to the same byte length so length differences don't leak timing.
  const bufA = Buffer.from(a.padEnd(Math.max(a.length, b.length), '\0'));
  const bufB = Buffer.from(b.padEnd(Math.max(a.length, b.length), '\0'));
  return timingSafeEqual(bufA, bufB);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const masterPassword = typeof body.masterPassword === 'string' ? body.masterPassword : '';

    if (!masterPassword) {
      return NextResponse.json({ error: 'Master password is required.' }, { status: 400 });
    }

    const correctPassword = process.env.ADMIN_LOGIN_PASSWORD;
    if (!correctPassword) {
      console.error('[request-otp] ADMIN_LOGIN_PASSWORD env var is not set.');
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    // Timing-safe comparison — prevents byte-by-byte timing oracles.
    const isMatch = timingSafeStringEqual(masterPassword, correctPassword);

    if (!isMatch) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    // ── Generate & persist OTP ──────────────────────────────────────────────
    const otp   = generateOtp();
    const nonce = generateNonce();

    try {
      const redis = getRedisClient();
      await redis.setex(`${OTP_KEY_PREFIX}${nonce}`, OTP_TTL_SECONDS, otp);
    } catch (error) {
      console.error('OTP Error:', error);
      return NextResponse.json({ error: 'Redis Connection Error' }, { status: 500 });
    }

    // ── Dispatch via Telegram ───────────────────────────────────────────────
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId   = TELEGRAM_CHAT_ID;

    if (!botToken) {
      console.error('[request-otp] TELEGRAM_BOT_TOKEN env var is not set.');
      return NextResponse.json({ error: 'Notification service not configured.' }, { status: 500 });
    }

    const telegramRes = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    chatId,
          parse_mode: 'MarkdownV2',
          text: [
            '🔐 *Quantum Mon Chéri \\— Terminal Access*',
            '',
            'Your one\\-time authentication code:',
            '',
            `\`${otp}\``,
            '',
            '⏱ Valid for *3 minutes*\\. Do not share this code\\.',
          ].join('\n'),
        }),
      },
    );

    if (!telegramRes.ok) {
      const errBody = await telegramRes.text().catch(() => '');
      console.error('[request-otp] Telegram dispatch failed:', telegramRes.status, errBody);
      return NextResponse.json({ error: 'Failed to send verification code.' }, { status: 502 });
    }

    return NextResponse.json({ success: true, nonce });

  } catch (err) {
    console.error('[request-otp] Unhandled error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
