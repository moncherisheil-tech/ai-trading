import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// PHASE 3 FIX: Sensitive API routes that require authentication.
//
// VULNERABILITY: The previous middleware bypassed ALL /api/ routes with a
// blanket `pathname.startsWith('/api/')` → NextResponse.next(). This meant
// /api/ops/diagnostics, /api/execution/*, /api/settings/* were completely
// unauthenticated — any actor on the internet could trigger trades, read
// system state, or modify configuration with zero credentials.
//
// FIX: Explicitly enumerate public API routes (allowlist). All other /api/
// routes require a valid signed session cookie.
// ---------------------------------------------------------------------------

const PUBLIC_API_PREFIXES: string[] = [
  '/api/auth/',          // login / logout endpoints
  '/api/health/',        // uptime probes (safe to expose)
  '/api/telegram/webhook', // Telegram bot webhook (auth handled by bot token)
];

// ---------------------------------------------------------------------------
// PHASE 3 FIX: IP Whitelist for ops/admin routes.
//
// Set OPS_ALLOWED_IPS env var as comma-separated list of trusted IPs.
// Example: OPS_ALLOWED_IPS=1.2.3.4,5.6.7.8,127.0.0.1
//
// If OPS_ALLOWED_IPS is not set (empty), IP whitelisting is DISABLED with a
// loud warning. This is intentional for bootstrapping — set the env var before
// go-live. For CIDR support, replace with a proper CIDR library.
//
// Routes gated by IP whitelist (IN ADDITION to cookie auth):
//   /ops/*, /admin/*, /api/ops/*, /api/execution/*, /api/settings/*
// ---------------------------------------------------------------------------

const OPS_IP_GATED_PREFIXES: string[] = [
  '/ops/',
  '/admin/',
  '/api/ops/',
  '/api/execution/',
  '/api/settings/',
  '/api/board/',
  '/api/analysis/',
];

function getIpWhitelist(): Set<string> | null {
  const raw = process.env.OPS_ALLOWED_IPS?.trim();
  if (!raw) return null; // Whitelist disabled — warn at startup
  const ips = raw.split(',').map((ip) => ip.trim()).filter(Boolean);
  return ips.length > 0 ? new Set(ips) : null;
}

function extractClientIp(request: NextRequest): string {
  // Prefer the standard Cloudflare/nginx forwarded header; fall back to Next.js `ip`.
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for may be "client, proxy1, proxy2" — take the leftmost (real client)
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp?.trim()) return cfIp.trim();
  return request.ip ?? 'unknown';
}

function isIpWhitelisted(ip: string, whitelist: Set<string> | null): boolean {
  if (whitelist === null) return true; // No whitelist configured → allow (with warning)
  return whitelist.has(ip);
}

// ---------------------------------------------------------------------------
// PHASE 3 FIX: Rate Limiter — Sliding Window (In-Memory)
//
// Prevents brute-force on login and API routes.
// Limitation: In-memory only — resets on process restart and is not shared
// across multiple instances. For multi-instance deployments, replace the
// `rateLimitStore` Map with an Upstash Redis INCR + EXPIRE call.
//
// Limits:
//   /api/auth/login   → 10 requests per 60 seconds per IP
//   All other ops API → 60 requests per 60 seconds per IP
// ---------------------------------------------------------------------------

interface RateLimitWindow {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitWindow>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute sliding window
const RATE_LIMIT_LOGIN_MAX = 10;     // max login attempts per window
const RATE_LIMIT_OPS_MAX = 60;       // max ops API calls per window

function checkRateLimit(key: string, max: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1 };
  }

  existing.count++;
  if (existing.count > max) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: max - existing.count };
}

// Periodically prune stale entries to prevent memory leak in long-running processes
let lastPruneAt = Date.now();
function pruneRateLimitStore(): void {
  const now = Date.now();
  if (now - lastPruneAt < 120_000) return; // Prune every 2 minutes max
  lastPruneAt = now;
  for (const [key, window] of rateLimitStore.entries()) {
    if (now - window.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Cookie verification (unchanged HMAC-SHA256 logic, kept as-is)
// ---------------------------------------------------------------------------

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
    result |= a[i]! ^ b[i]!;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isOpsIpGated(pathname: string): boolean {
  return OPS_IP_GATED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/static/')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/login') return true;
  if (pathname === '/manifest.json') return true;
  if (pathname.startsWith('/icons/')) return true;
  if (pathname === '/icon' || pathname === '/apple-icon') return true;
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|css|js\.map)$/i.test(pathname)) return true;
  return false;
}

function deny403(reason: string): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: 'Forbidden', reason }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
}

function deny429(retryAfterSecs = 60): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: 'Too Many Requests' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSecs),
        'X-RateLimit-Limit': String(RATE_LIMIT_LOGIN_MAX),
        'X-RateLimit-Remaining': '0',
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Main middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // HEAD probe for uptime monitors — never gate
  if (pathname === '/' && request.method === 'HEAD') {
    return NextResponse.next();
  }

  // Static assets / Next.js internals — fast bypass
  if (shouldBypassAuth(pathname)) {
    return NextResponse.next();
  }

  pruneRateLimitStore();

  const clientIp = extractClientIp(request);

  // ── PHASE 3 FIX: Rate Limit on Login ─────────────────────────────────────
  // Brute-force protection: 10 login attempts per IP per 60 seconds.
  // ─────────────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/auth/login')) {
    const rlKey = `login:${clientIp}`;
    const rl = checkRateLimit(rlKey, RATE_LIMIT_LOGIN_MAX);
    if (!rl.allowed) {
      console.warn(`[Middleware] Rate limit exceeded for login from IP ${clientIp}`);
      return deny429(60);
    }
    return NextResponse.next();
  }

  // ── PHASE 3 FIX: Protect sensitive API routes ─────────────────────────────
  // Previously ALL /api/ routes were unprotected. Now only explicitly listed
  // public prefixes are allowed through. All other API routes require auth.
  // ─────────────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    if (isPublicApiRoute(pathname)) {
      return NextResponse.next();
    }

    // Rate limit ops API routes
    const rlKey = `ops-api:${clientIp}`;
    const rl = checkRateLimit(rlKey, RATE_LIMIT_OPS_MAX);
    if (!rl.allowed) {
      console.warn(`[Middleware] Ops API rate limit exceeded from IP ${clientIp} on ${pathname}`);
      return deny429(60);
    }

    // ── PHASE 3 FIX: IP Whitelist for sensitive API routes ─────────────────
    if (isOpsIpGated(pathname)) {
      const whitelist = getIpWhitelist();
      if (whitelist === null) {
        // No whitelist configured — allow but log a startup warning
        console.warn(
          `[Middleware] OPS_ALLOWED_IPS is not set. IP whitelisting is DISABLED for ${pathname}. ` +
          `Set OPS_ALLOWED_IPS in .env to restrict access to trusted IPs.`
        );
      } else if (!isIpWhitelisted(clientIp, whitelist)) {
        console.warn(`[Middleware] IP ${clientIp} rejected for ${pathname} — not in OPS_ALLOWED_IPS`);
        return deny403('IP not whitelisted for this endpoint.');
      }
    }

    // Cookie auth check for protected API routes
    if (!(await verifyAuthCookie(request))) {
      return new NextResponse(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return NextResponse.next();
  }

  // ── Page routes: auth + IP whitelist ─────────────────────────────────────
  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  // IP whitelist for ops dashboard pages
  if (isOpsIpGated(pathname)) {
    const whitelist = getIpWhitelist();
    if (whitelist !== null && !isIpWhitelisted(clientIp, whitelist)) {
      console.warn(`[Middleware] IP ${clientIp} rejected for page ${pathname}`);
      return deny403('IP not whitelisted.');
    }
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot)$).*)',
  ],
};
