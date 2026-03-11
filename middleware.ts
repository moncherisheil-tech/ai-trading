import { NextRequest, NextResponse } from 'next/server';

/** Cookie set only after successful login (ADMIN_LOGIN_PASSWORD). All routes except /login and /api/auth require it. */
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

function hasAuthCookie(request: NextRequest): boolean {
  const token = request.cookies.get(OPS_AUTH_COOKIE)?.value;
  return Boolean(token?.trim());
}

/** Paths that do not require authentication. */
function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/auth')) return true;
  if (pathname.startsWith('/_next')) return true;
  if (pathname.includes('.')) return true; // static assets
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // All other routes require auth — redirect to login if no cookie
  if (!hasAuthCookie(request)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Workers: IP allowlist (optional extra layer)
  if (pathname.startsWith('/api/workers/') && !isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
