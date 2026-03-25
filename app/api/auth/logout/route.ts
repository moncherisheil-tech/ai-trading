import { NextRequest, NextResponse } from 'next/server';
import { isAllowedIp, verifyCsrf } from '@/lib/security';
import { shouldUseSecureCookies } from '@/lib/config';

export async function POST(request: NextRequest) {
  if (!isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { csrfToken?: string };
  if (!verifyCsrf(request, body.csrfToken)) {
    return NextResponse.json({ success: false, error: 'Invalid CSRF token.' }, { status: 403 });
  }

  const secureCookies = shouldUseSecureCookies();
  const res = NextResponse.json({ success: true });
  res.cookies.set('app_auth_token', '', {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
