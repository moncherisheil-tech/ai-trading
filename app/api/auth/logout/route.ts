import { NextRequest, NextResponse } from 'next/server';
import { isAllowedIp, verifyCsrf } from '@/lib/security';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export async function POST(request: NextRequest) {
  if (!isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { csrfToken?: string };
  if (!verifyCsrf(request, body.csrfToken)) {
    return NextResponse.json({ success: false, error: 'Invalid CSRF token.' }, { status: 403 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return res;
}
