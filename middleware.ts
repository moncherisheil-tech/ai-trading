import { NextRequest, NextResponse } from 'next/server';

/** Cookie set only after successful login (ADMIN_LOGIN_PASSWORD). Blocks /ops and /api/ops when missing. */
const OPS_AUTH_COOKIE = 'app_auth_token';

function isAllowedIp(request: NextRequest): boolean {
  const raw = process.env.ALLOWED_IPS || '';
  if (!raw.trim()) return true;

  const allowed = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (allowed.includes('*')) return true;

  const fwd = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = (fwd?.split(',')[0].trim() || realIp || 'unknown').trim();
  return allowed.includes(ip);
}

function isProtectedPath(pathname: string): boolean {
  return (
    pathname.startsWith('/ops') ||
    pathname === '/pnl' ||
    pathname.startsWith('/pnl/') ||
    pathname.startsWith('/api/ops')
  );
}

function hasAuthCookie(request: NextRequest): boolean {
  const token = request.cookies.get(OPS_AUTH_COOKIE)?.value;
  return Boolean(token?.trim());
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login page and static assets without auth
  if (pathname === '/login' || pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Protect /ops, /pnl, /api/ops — redirect unauthenticated to /login
  if (isProtectedPath(pathname)) {
    if (!hasAuthCookie(request)) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // Workers: IP allowlist
  if (pathname.startsWith('/api/workers/') && !isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/ops',
    '/ops/:path*',
    '/pnl',
    '/pnl/:path*',
    '/api/ops',
    '/api/ops/:path*',
    '/api/workers/:path*',
    '/login',
  ],
};
