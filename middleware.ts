import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_COOKIE_NAME = 'app_auth_token';

function hasAuthCookie(request: NextRequest): boolean {
  const value = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  return Boolean(value && value.trim().length > 0);
}

/**
 * Protects /ops and all children. Unauthenticated direct URL access redirects to /login.
 * Does not validate token signature (Edge); layout/page do server-side verifySessionToken + role.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/ops')) {
    return NextResponse.next();
  }

  if (!hasAuthCookie(request)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/ops', '/ops/:path*'],
};
