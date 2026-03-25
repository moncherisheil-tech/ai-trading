import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, isSessionEnabled, type SessionRole } from '@/lib/session';
import { isAllowedIp, verifyCsrf } from '@/lib/security';
import { shouldUseSecureCookies } from '@/lib/config';

export async function POST(request: NextRequest) {
  if (!isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
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
  const secureCookies = shouldUseSecureCookies();

  const res = NextResponse.json({ success: true, role: matched.role });
  res.cookies.set('app_auth_token', token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });

  return res;
}
