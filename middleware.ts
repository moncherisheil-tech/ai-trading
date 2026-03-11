import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE_NAME = 'app_auth_token';

function isAllowedIp(request: NextRequest): boolean {
  const raw = process.env.ALLOWED_IPS || '';
  if (!raw.trim()) return true;
  const allowed = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (allowed.includes('*')) return true;
  const fwd = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = (fwd?.split(',')[0].trim() || realIp || 'unknown').trim();
  return allowed.includes(ip);
}

/** Cookie present and non-empty. No domain logic — just the cookie name. */
function hasAuthCookie(request: NextRequest): boolean {
  const value = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  return Boolean(value && value.trim().length > 0);
}

/** Only these paths are allowed without auth. Everything else (including /) requires the cookie. */
function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/auth')) return true;
  // Next.js internals: static assets, RSC payloads, _next/data (must not redirect or login breaks)
  if (pathname.startsWith('/_next')) return true;
  if (pathname.includes('_next/data')) return true;
  if (pathname.includes('.')) return true; // static files (e.g. favicon.ico)
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // All other routes (including root '/') require auth
  if (!hasAuthCookie(request)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/api/workers/') && !isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  // Run on every path including root '/'. Do not skip the main page.
  matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).*)'],
};
