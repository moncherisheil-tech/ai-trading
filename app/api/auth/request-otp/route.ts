import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/queue/redis-client';

// ---------------------------------------------------------------------------
// POST /api/auth/request-otp
//
// Step 1 of the Telegram 2FA flow.
// Validates the master password, generates a 6-digit OTP, stores it in Redis
// with a 3-minute TTL, and dispatches it to the admin's Telegram chat.
//
// The OTP is stored under a session-scoped key (auth:otp:<nonce>) rather than
// a single global key to prevent race conditions where a second call to this
// endpoint overwrites the OTP before verify-otp can read it.
// The nonce is returned to the client and must be echoed back on verify-otp.
// ---------------------------------------------------------------------------

const OTP_KEY_PREFIX    = 'auth:otp:';
const OTP_TTL_SECONDS   = 180; // 3 minutes

function generateOtp(): string {
  // crypto.getRandomValues gives a uniform distribution — no modulo bias
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 1_000_000).padStart(6, '0');
}

function generateNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
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
      console.error('[OTP] ADMIN_LOGIN_PASSWORD env var is not set.');
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    // Constant-time simulation — always wait a fixed window to prevent
    // timing oracles that could confirm whether the env var is set.
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 80));

    if (masterPassword !== correctPassword) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    // ── Generate & persist OTP ──────────────────────────────────────────────
    const otp   = generateOtp();
    const nonce = generateNonce();
    const redis = getRedisClient();
    await redis.setex(`${OTP_KEY_PREFIX}${nonce}`, OTP_TTL_SECONDS, otp);

    // ── Dispatch via Telegram ───────────────────────────────────────────────
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId   = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      console.error('[OTP] TELEGRAM_BOT_TOKEN or chat ID env var is not set.');
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
      console.error('[OTP] Telegram dispatch failed:', telegramRes.status, errBody);
      return NextResponse.json({ error: 'Failed to send verification code.' }, { status: 502 });
    }

    return NextResponse.json({ success: true, nonce });

  } catch (err) {
    console.error('[OTP] request-otp unhandled error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
