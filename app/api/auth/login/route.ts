import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, isSessionEnabled, type SessionRole } from '@/lib/session';
import { isAllowedIp, verifyCsrf, getRequestIp } from '@/lib/security';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';
import { allowDistributedRequest } from '@/lib/rate-limit-distributed';
import { allowRequest } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  if (!isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  // Rate limit: 5 login attempts per IP per minute.
  const ip = getRequestIp(request);
  const rlKey = `auth:login:${ip}`;
  const distributed = await allowDistributedRequest(rlKey, 5, 60_000);
  const allowed = distributed !== null ? distributed : allowRequest(rlKey, 5, 60_000);
  if (!allowed) {
    return NextResponse.json({ success: false, error: 'Too many attempts. Please wait before trying again.' }, { status: 429 });
  }

  if (!isSessionEnabled()) {
    return NextResponse.json({ success: false, error: 'Auth session is not configured.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { password?: string; csrfToken?: string };
  if (!verifyCsrf(request, body.csrfToken)) {
    return NextResponse.json({ success: false, error: 'Invalid CSRF token.' }, { status: 403 });
  }

  const credentials: Array<{ role: SessionRole; password: string | undefined }> = [
    { role: 'admin', password: process.env.ADMIN_LOGIN_PASSWORD },
    { role: 'operator', password: process.env.OPERATOR_LOGIN_PASSWORD },
    { role: 'viewer', password: process.env.VIEWER_LOGIN_PASSWORD },
  ];

  const matched = credentials.find((entry) => entry.password && body.password === entry.password);

  if (!matched) {
    return NextResponse.json({ success: false, error: 'Invalid credentials.' }, { status: 401 });
  }

  const token = createSessionToken(matched.role);

  const res = NextResponse.json({ success: true, role: matched.role });
  res.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 12,
  });

  return res;
}
