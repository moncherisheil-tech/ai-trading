import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';

const AUTH_COOKIE_NAME = 'app_auth_token';

function base64UrlToUint8Array(input: string): Uint8Array | null {
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

async function verifyAuthCookie(request: NextRequest): Promise<boolean> {
  const value = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!value || value.trim().length === 0) return false;

  const token = value.trim();
  const [payloadB64, signature, ...rest] = token.split('.');
  if (!payloadB64 || !signature || rest.length > 0) return false;

  const payloadBytes = base64UrlToUint8Array(payloadB64);
  const signatureBytes = base64UrlToUint8Array(signature);
  if (!payloadBytes || !signatureBytes) return false;

  const payloadText = new TextDecoder().decode(payloadBytes);
  let payload: { exp?: number } | null = null;
  try {
    payload = JSON.parse(payloadText) as { exp?: number };
  } catch {
    return false;
  }
  if (!payload?.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const activeSecrets = [
    process.env.APP_SESSION_SECRET ?? '',
    process.env.APP_SESSION_SECRET_PREVIOUS ?? '',
  ].filter(Boolean);
  if (activeSecrets.length === 0) return false;

  const encoder = new TextEncoder();
  const payloadRaw = encoder.encode(payloadB64);

  for (const secret of activeSecrets) {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const expected = await crypto.subtle.sign('HMAC', key, payloadRaw);
    const expectedBytes = new Uint8Array(expected);
    if (safeEqual(signatureBytes, expectedBytes)) {
      return true;
    }
  }

  return false;
}

/**
 * Paths that are always allowed without authentication (whitelist).
 * Everything else requires a valid app_auth_token cookie.
 * Cron paths: no longer accept URL query secrets; headers only.
 */
function isWhitelisted(pathname: string, request: NextRequest): boolean {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/health/')) return true;
  if (pathname.startsWith('/api/telegram/webhook')) return true;
  if (pathname === '/manifest.json') return true;
  if (pathname.startsWith('/icons/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/icon' || pathname === '/apple-icon') return true;
  if (pathname.startsWith('/api/auth/login') || pathname.startsWith('/api/auth/logout')) return true;
  return false;
}

function isStrictOperationalApi(pathname: string): boolean {
  return (
    pathname.startsWith('/api/ops/') ||
    pathname === '/api/admin/terminal' ||
    pathname === '/api/portfolio/virtual' ||
    pathname === '/api/simulation/reset' ||
    pathname === '/api/trading/execute-signal' ||
    pathname === '/api/academy/rag'
  );
}

function isProtectedPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/ops' || pathname.startsWith('/ops/') || pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * Zero-trust gate for dashboard routes:
 * - Root dashboard (/)
 * - All ops routes (/ops/:path*)
 * Missing/malformed auth cookie is redirected immediately to /login.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isStrictOperationalApi(pathname) && !validateAdminOrCronAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (isWhitelisted(pathname, request)) {
    return NextResponse.next();
  }

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  if (!(await verifyAuthCookie(request))) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/ops/:path*',
    '/admin/:path*',
    '/api/ops/:path*',
    '/api/admin/terminal',
    '/api/portfolio/virtual',
    '/api/simulation/reset',
    '/api/trading/execute-signal',
    '/api/academy/rag',
  ],
};
