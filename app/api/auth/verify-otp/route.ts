import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/queue/redis-client';
import { createSessionToken } from '@/lib/session';

// ---------------------------------------------------------------------------
// POST /api/auth/verify-otp
//
// Step 2 of the Telegram 2FA flow.
// Validates the 6-digit OTP against the Redis-stored value.
// On success: deletes the OTP (single-use), issues a signed HTTP-Only
// session cookie (app_auth_token), and returns { success: true, redirectTo }.
// ---------------------------------------------------------------------------

const OTP_REDIS_KEY       = 'auth:otp';
const AUTH_COOKIE_NAME    = 'app_auth_token';
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const otp  = typeof body.otp === 'string' ? body.otp.trim() : '';

    if (!otp || !/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: 'A valid 6-digit code is required.' }, { status: 400 });
    }

    const redis     = getRedisClient();
    const storedOtp = await redis.get(OTP_REDIS_KEY);

    if (!storedOtp) {
      return NextResponse.json(
        { error: 'Code has expired or was never issued. Request a new one.' },
        { status: 401 },
      );
    }

    if (storedOtp !== otp) {
      return NextResponse.json({ error: 'Invalid code.' }, { status: 401 });
    }

    // ── Invalidate OTP (single-use) ─────────────────────────────────────────
    await redis.del(OTP_REDIS_KEY);

    // ── Issue session cookie ────────────────────────────────────────────────
    const token = createSessionToken('admin', SESSION_TTL_SECONDS);

    const response = NextResponse.json({ success: true, redirectTo: '/ops' });

    response.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path:     '/',
      maxAge:   SESSION_TTL_SECONDS,
    });

    return response;

  } catch (err) {
    console.error('[OTP] verify-otp unhandled error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
