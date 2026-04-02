import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getHttpRedisClient } from '@/lib/queue/redis-client';

// ---------------------------------------------------------------------------
// POST /api/auth/request-otp
//
// Step 1 of the Telegram 2FA flow.
// Validates the master password using a timing-safe byte-level comparison to
// prevent timing-oracle attacks. On success: generates a 6-digit OTP, stores
// it in Redis with a 3-minute TTL, and dispatches it to the admin Telegram
// chat asynchronously (non-blocking) so the nonce is returned immediately.
//
// The OTP is scoped to a per-request nonce (auth:otp:<nonce>) to prevent
// race conditions where a concurrent call overwrites the OTP before
// verify-otp can consume it. The nonce is returned to the client and must
// be echoed back on verify-otp.
// ---------------------------------------------------------------------------

const OTP_KEY_PREFIX  = 'auth:otp:';
const OTP_TTL_SECONDS = 180; // 3 minutes
const REDIS_OP_TIMEOUT_MS = 5_000;
const TELEGRAM_OP_TIMEOUT_MS = 10_000;

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
  const bufA = Buffer.from(a.padEnd(Math.max(a.length, b.length), '\0'));
  const bufB = Buffer.from(b.padEnd(Math.max(a.length, b.length), '\0'));
  return timingSafeEqual(bufA, bufB);
}

/** Wraps a promise with a hard deadline; rejects with a timeout error if exceeded. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[request-otp] ${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Fire-and-forget Telegram OTP dispatch. Errors are logged but never surface
 * to the caller — the nonce has already been returned to the client by the
 * time this function is awaited internally.
 */
async function dispatchTelegramOtp(otp: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId   = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!botToken || !chatId) {
    console.error('[request-otp] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set — OTP not dispatched via Telegram.');
    return;
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TELEGRAM_OP_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
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
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('[request-otp] Telegram dispatch failed:', res.status, errBody);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[request-otp] Telegram dispatch error (non-blocking, OTP still valid):', msg);
  }
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

    const isMatch = timingSafeStringEqual(masterPassword, correctPassword);

    if (!isMatch) {
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    // ── Generate & persist OTP ──────────────────────────────────────────────
    const otp   = generateOtp();
    const nonce = generateNonce();

    try {
      const redis = getHttpRedisClient();
      await withTimeout(
        redis.setex(`${OTP_KEY_PREFIX}${nonce}`, OTP_TTL_SECONDS, otp),
        REDIS_OP_TIMEOUT_MS,
        'redis.setex'
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[request-otp] Redis error:', msg);
      return NextResponse.json({ error: 'Session store unavailable. Please try again.' }, { status: 500 });
    }

    // ── Dispatch OTP via Telegram — NON-BLOCKING ────────────────────────────
    // We intentionally do NOT await this. The nonce is already persisted in
    // Redis; the client can enter the OTP as soon as Telegram delivers it.
    // Network latency to Telegram (Israel → EU) was the primary cause of the
    // 5000ms+ 'message handler' violation. This call now runs in the background.
    void dispatchTelegramOtp(otp);

    return NextResponse.json({ success: true, nonce });

  } catch (err) {
    console.error('[request-otp] Unhandled error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
