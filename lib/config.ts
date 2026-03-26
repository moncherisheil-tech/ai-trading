import 'dotenv/config';
import { CRYPTO_SYMBOLS } from './symbols';

/** Production base URL for absolute links and redirects. Set APP_URL in .env. */
export const BASE_URL = normalizeAppUrl(process.env.APP_URL);

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
  // Keep local/non-SSL environments functional by defaulting to http.
  return `http://${value}`.replace(/\/$/, '');
}

/**
 * Absolute base URL for server-side fetch. Use in Server Components / Server Actions.
 * Order: NEXT_PUBLIC_APP_URL → APP_URL → PUBLIC_URL → http://localhost:3000
 */
export function getBaseUrl(): string {
  const u = normalizeAppUrl(
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.PUBLIC_URL ||
    'http://localhost:3000'
  );
  return u || 'http://localhost:3000';
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
  /** Primary Gemini model. */
  primaryModel: process.env.GEMINI_MODEL_PRIMARY || 'gemini-3-flash-preview',
  fallbackModel: process.env.GEMINI_MODEL_FALLBACK || 'gemini-3-flash-preview',
  /** Model used when primary returns 429 (quota exhausted). */
  quotaFallbackModel: process.env.GEMINI_MODEL_QUOTA_FALLBACK || 'gemini-3-flash-preview',
  authToken: process.env.APP_AUTH_TOKEN || '',
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY || '',
  dbDriver: process.env.DB_DRIVER || 'file',
  sqlitePath: process.env.SQLITE_DB_PATH || 'predictions.sqlite',
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

/** סימבולי Binance (עם USDT) לניתוח ולבדיקות. */
export const TARGET_SYMBOLS = CRYPTO_SYMBOLS.map((b) => `${b}USDT`) as readonly string[];
