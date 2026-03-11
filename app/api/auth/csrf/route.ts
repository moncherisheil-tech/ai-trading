import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

export async function GET() {
  const token = randomUUID();
  const res = NextResponse.json({ success: true, csrfToken: token });
  res.cookies.set('csrf_token', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
  return res;
}
