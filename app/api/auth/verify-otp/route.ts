import { NextRequest, NextResponse } from 'next/server';
import { getHttpRedisClient } from '@/lib/queue/redis-client';
import { createSessionToken } from '@/lib/session';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';
import { allowDistributedRequest } from '@/lib/rate-limit-distributed';
import { allowRequest } from '@/lib/rate-limit';
import { getRequestIp } from '@/lib/security';

// ---------------------------------------------------------------------------
// POST /api/auth/verify-otp
//
// Step 2 of the Telegram 2FA flow.
// Validates the 6-digit OTP against the Redis-stored value (auth:otp:<nonce>).
// On success: deletes the OTP (single-use), issues a signed HTTP-Only
// session cookie (quantum_auth_session) and returns { success, redirectTo }.
// ---------------------------------------------------------------------------

const OTP_KEY_PREFIX  = 'auth:otp:'; // must match request-otp
const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Rate limit per IP: 5 OTP guesses per minute — caps brute-force of the 6-digit code space.
  const ip = getRequestIp(request);
  const rlKey = `auth:verify-otp:${ip}`;
  const distributed = await allowDistributedRequest(rlKey, 5, 60_000);
  const allowed = distributed !== null ? distributed : allowRequest(rlKey, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait before trying again.' }, { status: 429 });
  }

  try {
    const body  = await request.json().catch(() => ({})) as Record<string, unknown>;
    const otp   = typeof body.otp   === 'string' ? body.otp.trim()   : '';
    const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';

    if (!otp || !/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: 'A valid 6-digit code is required.' }, { status: 400 });
    }

    if (!nonce || !/^[0-9a-f]{32}$/.test(nonce)) {
      return NextResponse.json(
        { error: 'Session token missing. Please request a new code.' },
        { status: 400 },
      );
    }

    try {
      const redis    = getHttpRedisClient();
      const redisKey = `${OTP_KEY_PREFIX}${nonce}`;
      const stored   = await redis.get(redisKey);

      if (!stored) {
        return NextResponse.json(
          { error: 'Code has expired or was never issued. Request a new one.' },
          { status: 401 },
        );
      }

      if (stored !== otp) {
        return NextResponse.json({ error: 'Invalid code.' }, { status: 401 });
      }

      await redis.del(redisKey); // single-use: invalidate immediately
    } catch (err) {
      console.error('[verify-otp] Redis error:', err);
      return NextResponse.json({ error: 'Redis connection error.' }, { status: 500 });
    }

    // ── Issue session cookie ────────────────────────────────────────────────
    const token = createSessionToken('admin', SESSION_MAX_AGE);

    console.log('SETTING COOKIE: quantum_auth_session');

    const response = NextResponse.json({ success: true, redirectTo: '/ops' });

    response.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure:   true,
      sameSite: 'strict',
      path:     '/',
      maxAge:   SESSION_MAX_AGE,
    });

    return response;

  } catch (err) {
    console.error('[verify-otp] Unhandled error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
