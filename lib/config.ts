/** Production base URL for absolute links and redirects. Set APP_URL in .env. */
export const BASE_URL = process.env.APP_URL || '';

/**
 * Absolute base URL for server-side fetch. Use in Server Components / Server Actions.
 * Order: NEXT_PUBLIC_APP_URL → APP_URL → https://VERCEL_URL → http://localhost:3000
 */
export function getBaseUrl(): string {
  const u =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    'http://localhost:3000';
  return u.replace(/\/$/, '');
}

export const APP_CONFIG = {
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
  primaryModel: process.env.GEMINI_MODEL_PRIMARY || 'gemini-3.1-pro-preview',
  fallbackModel: process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.5-pro',
  authToken: process.env.APP_AUTH_TOKEN || '',
  turnstileSecret: process.env.TURNSTILE_SECRET_KEY || '',
  dbDriver: process.env.DB_DRIVER || 'file',
  sqlitePath: process.env.SQLITE_DB_PATH || 'predictions.sqlite',
  postgresUrl: process.env.DATABASE_URL || '',
  backupKeep: Number(process.env.DB_BACKUP_KEEP || 7),
  /** Timeout for Gemini API calls (ms); prevents server hang on slow responses. */
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 60_000),
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

import { CRYPTO_SYMBOLS } from './symbols';

/** סימבולי Binance (עם USDT) לניתוח ולבדיקות. */
export const TARGET_SYMBOLS = CRYPTO_SYMBOLS.map((b) => `${b}USDT`) as readonly string[];
