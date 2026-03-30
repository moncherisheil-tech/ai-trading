import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// OOB Telegram 2FA Auth Model
//
// Access control is now exclusively cookie-based. IP whitelisting has been
// removed to support global CEO mobility. Authentication is gated by:
//   1. Master Password → /api/auth/request-otp  (dispatches OTP via Telegram)
//   2. 6-digit OTP     → /api/auth/verify-otp   (issues signed session cookie)
//
// The signed HMAC-SHA256 session cookie (app_auth_token) is the sole
// mechanism for identifying authenticated sessions.
// ---------------------------------------------------------------------------

const PUBLIC_API_PREFIXES: string[] = [
  '/api/auth/',             // login / logout / otp endpoints
  '/api/health/',           // uptime probes — safe to expose
  '/api/telegram/webhook',  // Telegram bot webhook (auth via bot token)
];

// ---------------------------------------------------------------------------
// Rate Limiter — Sliding Window (In-Memory)
// Shared limit for auth endpoints and a separate limit for ops API.
// For multi-instance deployments, back this with Upstash Redis INCR + EXPIRE.
// ---------------------------------------------------------------------------

interface RateLimitWindow {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitWindow>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_AUTH_MAX  = 10;  // 10 auth attempts/60 s per IP (covers login + OTP)
const RATE_LIMIT_OPS_MAX   = 60;  // 60 ops API calls/60 s per IP

function checkRateLimit(key: string, max: number): { allowed: boolean } {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  existing.count++;
  return { allowed: existing.count <= max };
}

let lastPruneAt = Date.now();
function pruneRateLimitStore(): void {
  const now = Date.now();
  if (now - lastPruneAt < 120_000) return;
  lastPruneAt = now;
  for (const [key, window] of rateLimitStore.entries()) {
    if (now - window.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Cookie verification — HMAC-SHA256 signed token (unchanged core logic)
// Supports secret rotation via APP_SESSION_SECRET_PREVIOUS.
// ---------------------------------------------------------------------------

const AUTH_COOKIE_NAME = 'app_auth_token';

function base64UrlToUint8Array(input: string): Uint8Array | null {
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded  = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary  = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a[i]! ^ b[i]!;
  return result === 0;
}

async function verifyAuthCookie(request: NextRequest): Promise<boolean> {
  const value = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!value?.trim()) return false;

  const token = value.trim();
  const [payloadB64, signature, ...rest] = token.split('.');
  if (!payloadB64 || !signature || rest.length > 0) return false;

  const payloadBytes   = base64UrlToUint8Array(payloadB64);
  const signatureBytes = base64UrlToUint8Array(signature);
  if (!payloadBytes || !signatureBytes) return false;

  let payload: { exp?: number } | null = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as { exp?: number };
  } catch {
    return false;
  }
  if (!payload?.exp || payload.exp <= Math.floor(Date.now() / 1000)) return false;

  const activeSecrets = [
    process.env.APP_SESSION_SECRET         ?? '',
    process.env.APP_SESSION_SECRET_PREVIOUS ?? '',
  ].filter(Boolean);
  if (activeSecrets.length === 0) return false;

  const encoder    = new TextEncoder();
  const payloadRaw = encoder.encode(payloadB64);

  for (const secret of activeSecrets) {
    const key      = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, payloadRaw));
    if (safeEqual(signatureBytes, expected)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

function isProtectedPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/ops' ||
    pathname.startsWith('/ops/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/')
  );
}

function shouldBypassAuth(pathname: string): boolean {
  if (pathname.startsWith('/_next/'))   return true;
  if (pathname.startsWith('/static/'))  return true;
  if (pathname === '/favicon.ico')      return true;
  if (pathname === '/login')            return true;
  if (pathname === '/manifest.json')    return true;
  if (pathname.startsWith('/icons/'))   return true;
  if (pathname === '/icon' || pathname === '/apple-icon') return true;
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|css|js\.map)$/i.test(pathname)) return true;
  return false;
}

function deny401(): NextResponse {
  return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deny429(retryAfterSecs = 60): NextResponse {
  return new NextResponse(JSON.stringify({ error: 'Too Many Requests' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSecs),
    },
  });
}

// ---------------------------------------------------------------------------
// Main middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // HEAD probes for uptime monitors — never gate
  if (pathname === '/' && request.method === 'HEAD') return NextResponse.next();

  // Static assets / Next.js internals
  if (shouldBypassAuth(pathname)) return NextResponse.next();

  pruneRateLimitStore();

  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim()               ||
    request.ip                                                     ||
    'unknown';

  // ── Rate-limit all authentication endpoints ────────────────────────────────
  // /api/auth/login, /api/auth/request-otp, /api/auth/verify-otp share one
  // 10-req/60-s window per IP to prevent brute-force across all auth paths.
  if (
    pathname.startsWith('/api/auth/login')       ||
    pathname.startsWith('/api/auth/request-otp') ||
    pathname.startsWith('/api/auth/verify-otp')
  ) {
    if (!checkRateLimit(`auth:${clientIp}`, RATE_LIMIT_AUTH_MAX).allowed) {
      console.warn(`[Middleware] Auth rate limit exceeded from ${clientIp}`);
      return deny429(60);
    }
    return NextResponse.next();
  }

  // ── All other /api/ routes ─────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    if (isPublicApiRoute(pathname)) return NextResponse.next();

    if (!checkRateLimit(`ops-api:${clientIp}`, RATE_LIMIT_OPS_MAX).allowed) {
      console.warn(`[Middleware] Ops API rate limit exceeded from ${clientIp} on ${pathname}`);
      return deny429(60);
    }

    if (!(await verifyAuthCookie(request))) return deny401();
    return NextResponse.next();
  }

  // ── Page routes ────────────────────────────────────────────────────────────
  if (!isProtectedPath(pathname)) return NextResponse.next();

  if (!(await verifyAuthCookie(request))) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot)$).*)',
  ],
};
