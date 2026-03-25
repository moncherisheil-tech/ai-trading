import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { shouldUseSecureCookies } from '@/lib/config';

export async function GET() {
  const token = randomUUID();
  const secureCookies = shouldUseSecureCookies();
  const res = NextResponse.json({ success: true, csrfToken: token });
  res.cookies.set('csrf_token', token, {
    httpOnly: false,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
  return res;
}
