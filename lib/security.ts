import type { NextRequest } from 'next/server';

export function getRequestIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    return fwd.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return 'unknown';
}

export function isAllowedIp(request: NextRequest): boolean {
  const raw = process.env.ALLOWED_IPS || '';
  if (!raw.trim()) return true;

  const allowed = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (allowed.includes('*')) return true;

  const ip = getRequestIp(request);
  return allowed.includes(ip);
}

export function verifyCsrf(request: NextRequest, csrfFromClient: string | undefined): boolean {
  const cookieToken = request.cookies.get('csrf_token')?.value || '';
  const headerToken = request.headers.get('x-csrf-token') || '';
  const token = csrfFromClient || headerToken;
  return Boolean(cookieToken) && token === cookieToken;
}
