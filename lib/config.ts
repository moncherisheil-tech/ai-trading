import { GEMINI_CANONICAL_PRO_MODEL_ID, normalizeGeminiModelId } from './gemini-model';
import { CRYPTO_SYMBOLS } from './symbols';

const PRODUCTION_FALLBACK_URL = 'https://quantum.moncherigroup.co.il';

function normalizeEnvValue(raw: string | undefined): string {
  const value = (raw || '').trim();
  if (!value) return '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function normalizeAppUrl(raw: string | undefined): string {
  const value = normalizeEnvValue(raw);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) {
    return value.replace(/\/$/, '');
  }
  return `http://${value}`.replace(/\/$/, '');
}

function isLocalhostUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
}

/**
 * Absolute base URL for server-side fetch. Use in Server Components / Server Actions.
 *
 * Resolution order (first non-empty, non-localhost-in-production wins):
 *   NEXT_PUBLIC_SITE_URL → NEXT_PUBLIC_APP_URL → APP_URL → PUBLIC_URL → hardcoded production domain
 *
 * In production (NODE_ENV=production), localhost/127.0.0.1 URLs are skipped to prevent
 * accidental internal-only redirects from reaching external clients.
 */
export function getBaseUrl(): string {
  const isProduction = process.env.NODE_ENV === 'production';

  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.PUBLIC_URL,
  ];

  for (const raw of candidates) {
    const u = normalizeAppUrl(raw);
    if (!u) continue;
    if (isProduction && isLocalhostUrl(u)) continue;
    return u;
  }

  return PRODUCTION_FALLBACK_URL;
}

/**
 * Production base URL constant — resolved once at module load using the same priority chain
 * as getBaseUrl(). Prefer calling getBaseUrl() directly; this export exists for legacy callers.
 */
export const BASE_URL = getBaseUrl();

/**
 * Internal loopback base URL for server-to-server API calls within the same process / host.
 * Always resolves to http://127.0.0.1:{PORT} regardless of NODE_ENV, bypassing the
 * external domain lookup that causes UND_ERR_CONNECT_TIMEOUT on production servers.
 *
 * Use this instead of getBaseUrl() whenever one API route calls another API route on the
 * same Next.js server (e.g. cron → agent → trading routes).
 */
export function getInternalBaseUrl(): string {
  const port = (process.env.PORT || '3000').replace(/[^0-9]/g, '') || '3000';
  return `http://127.0.0.1:${port}`;
}

/** Secure cookies only when APP_URL is explicitly https. */
export function shouldUseSecureCookies(): boolean {
  const baseUrl = getBaseUrl();
  return /^https:\/\//i.test(baseUrl);
}

export const APP_CONFIG = {
  isLiveMode: String(process.env.IS_LIVE_MODE || 'false').toLowerCase() === 'true',
  aiProvider: String(process.env.AI_PROVIDER || 'gemini').toLowerCase(),
  fetchTimeoutMs: 12_000,
  analysisRateLimitWindowMs: Number(process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS || 60_000),
  analysisRateLimitMax: Number(process.env.ANALYSIS_RATE_LIMIT_MAX || 12),
  analysisDedupWindowMs: Number(process.env.ANALYSIS_DEDUP_WINDOW_MS || 30_000),
  maxFetchRetries: Number(process.env.MAX_FETCH_RETRIES || 3),
  minHumanDelayMs: Number(process.env.MIN_HUMAN_DELAY_MS || 1200),
  trustedApiOrigins: ['https://api.binance.com', 'https://api.alternative.me'] as string[],
  /** Optional proxy for Binance when API returns 451 (e.g. region block). Example: https://your-proxy.com/binance */
  proxyBinanceUrl: (process.env.PROXY_BINANCE_URL || '').replace(/\/$/, ''),
  tickerSocketUrl: 'wss://stream.binance.com:9443/ws/!miniTicker@arr',
  tickerReconnectBaseMs: 1_500,
  tickerReconnectMaxMs: 15_000,
  /** Alpha Engine generative default: gemini-3.1-pro-preview (env may override; legacy IDs normalized). */
  primaryModel: normalizeGeminiModelId(
    process.env.GEMINI_MODEL_PRIMARY || GEMINI_CANONICAL_PRO_MODEL_ID
  ),
  fallbackModel: normalizeGeminiModelId(
    process.env.GEMINI_MODEL_FALLBACK || GEMINI_CANONICAL_PRO_MODEL_ID
  ),
  /** Model used when primary returns 429 (quota exhausted). */
  quotaFallbackModel: normalizeGeminiModelId(
    process.env.GEMINI_MODEL_QUOTA_FALLBACK || GEMINI_CANONICAL_PRO_MODEL_ID
  ),
  authToken: process.env.APP_AUTH_TOKEN || '',
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY || '',
  postgresUrl: normalizeEnvValue(process.env.DATABASE_URL),
  backupKeep: Number(process.env.DB_BACKUP_KEEP || 7),
  /** Timeout for Gemini API calls (ms); prevents server hang on slow responses. */
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 60_000),
  /** Delay in ms between each symbol in cron scanner to avoid Binance 1200 weight/min limit. */
  scannerDelayBetweenSymbolsMs: Number(process.env.SCANNER_DELAY_BETWEEN_SYMBOLS_MS || 350),
  /** Paper trading: slippage in basis points (1 bps = 0.01%). Buy executes higher, sell lower. Default 5 bps = 0.05%. */
  paperSlippageBps: Number(process.env.PAPER_SLIPPAGE_BPS || 5),
  /** Paper trading: auto-close (simulated liquidation) when unrealized PnL % <= this. Default -75%. */
  paperLiquidationPct: Number(process.env.PAPER_LIQUIDATION_PCT || -75),
};

// ---------------------------------------------------------------------------
// Redis / Workspace 2 — canonical URL resolution (BullMQ, HTTP cache, whale sub)
// All connection code should read these helpers instead of raw process.env
// so quotes, trimming, and fallbacks stay consistent across the monolith.
// ---------------------------------------------------------------------------

/** BullMQ + queue-worker Redis. Falls back to local broker only when REDIS_URL is unset. */
export function getResolvedRedisUrl(): string {
  const v = normalizeEnvValue(process.env.REDIS_URL);
  return v || 'redis://127.0.0.1:6379';
}

/** Remote ingestion Redis (e.g. German node / i9 → quant:alerts). Null if unset. */
export function getResolvedWhaleRedisUrl(): string | null {
  const v = normalizeEnvValue(process.env.WHALE_REDIS_URL);
  return v || null;
}

/**
 * Redis URL for HTTP routes / cache shield — prefers WHALE_REDIS_URL, then REDIS_URL.
 * @throws if neither variable is set (API handlers must not silently use localhost).
 */
export function getResolvedHttpRedisUrl(): string {
  const whale = getResolvedWhaleRedisUrl();
  const main = normalizeEnvValue(process.env.REDIS_URL);
  const url = whale || main;
  if (!url) {
    throw new Error(
      '[config] Neither WHALE_REDIS_URL nor REDIS_URL is set. ' +
      'Set at least one in .env for Redis-backed API routes.'
    );
  }
  return url;
}

if (APP_CONFIG.proxyBinanceUrl) {
  try {
    const origin = new URL(APP_CONFIG.proxyBinanceUrl).origin;
    if (!APP_CONFIG.trustedApiOrigins.includes(origin)) {
      APP_CONFIG.trustedApiOrigins = [...APP_CONFIG.trustedApiOrigins, origin];
    }
  } catch {
    // invalid PROXY_BINANCE_URL ignored
  }
}

// ---------------------------------------------------------------------------
// Boot-time environment validation — fail fast rather than fail silent.
// The server MUST NOT start if critical secrets are absent.
//
// SECURITY NOTE: This block runs ONLY on the server (typeof window === 'undefined').
// Client bundles never execute this code, so no secrets leak to the browser.
// DYDX_WALLET_PRIVATE_KEY is only required when IS_LIVE_MODE=true AND DRY_RUN != 'true',
// preventing false-positive crashes in paper-trading / simulation mode.
// ---------------------------------------------------------------------------
const REQUIRED_ENV_VARS: Array<{ key: string; description: string; liveOnly?: boolean }> = [
  { key: 'APP_SESSION_SECRET',         description: 'HMAC signing key for session cookies' },
  { key: 'DATABASE_URL',               description: 'PostgreSQL connection string' },
  { key: 'ADMIN_SECRET',               description: 'Bearer token for administrative API routes' },
  {
    key: 'DYDX_WALLET_PRIVATE_KEY',
    description: 'dYdX wallet private key (hex) or 12/24-word mnemonic for perpetuals execution',
    liveOnly: true,  // Only required when IS_LIVE_MODE=true AND DRY_RUN=false
  },
];

if (typeof window === 'undefined' && process.env.NODE_ENV !== 'test') {
  const isLiveMode = String(process.env.IS_LIVE_MODE || 'false').toLowerCase() === 'true';
  const isDryRun   = String(process.env.DRY_RUN   || 'true').toLowerCase()  === 'true';

  const missing = REQUIRED_ENV_VARS.filter(({ key, liveOnly }) => {
    // Skip live-only vars when running in paper/dry-run mode to prevent false-positive crashes
    if (liveOnly && (!isLiveMode || isDryRun)) return false;
    return !process.env[key]?.trim();
  });

  if (missing.length > 0) {
    const lines = missing.map(({ key, description }) => `  • ${key}  — ${description}`).join('\n');
    throw new Error(
      `\n\n╔══════════════════════════════════════════════════════╗\n` +
      `║  FATAL: Required environment variables are missing  ║\n` +
      `╚══════════════════════════════════════════════════════╝\n\n` +
      `${lines}\n\n` +
      `Copy .env.example to .env and populate all required values.\n`
    );
  }
}

/** סימבולי Binance (עם USDT) לניתוח ולבדיקות. */
export const TARGET_SYMBOLS = CRYPTO_SYMBOLS.map((b) => `${b}USDT`) as readonly string[];
