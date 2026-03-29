/**
 * Zero-Latency Binance Oracle — In-Memory Singleton.
 *
 * Maintains a background-polled cache of the USDT/ILS exchange rate.
 * All consensus-phase reads are O(1) with ZERO network latency.
 * Network I/O happens only in the background poller, never on the hot path.
 *
 * Architecture:
 *   startOraclePoller()  → call once at server boot (instrumentation.ts or first import)
 *   getUsdtIlsRate()     → synchronous O(1) cache read (null if stale/uninitialized)
 *   getUsdtIlsRateAsync()→ async fallback — triggers one blocking fetch if cache is cold
 */

import { APP_CONFIG } from '@/lib/config';

const POLL_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 120_000;
const FETCH_TIMEOUT_MS = 8_000;

interface OracleSnapshot {
  usdtIls: number | null;
  updatedAtMs: number;
}

let _cache: OracleSnapshot = { usdtIls: null, updatedAtMs: 0 };
let _pollerTimer: ReturnType<typeof setInterval> | null = null;

async function _fetchFromBinance(): Promise<number | null> {
  try {
    const base = ((APP_CONFIG as Record<string, unknown>)['proxyBinanceUrl'] as string | undefined || 'https://api.binance.com').replace(/\/$/, '');
    const url = `${base}/api/v3/ticker/price?symbol=USDTILS`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: string };
    const price = Number(data.price);
    return Number.isFinite(price) && price > 0 ? Math.round(price * 10_000) / 10_000 : null;
  } catch {
    return null;
  }
}

async function _tick(): Promise<void> {
  const rate = await _fetchFromBinance();
  if (rate !== null) {
    _cache = { usdtIls: rate, updatedAtMs: Date.now() };
  }
}

/**
 * Start the background oracle poller.
 * Idempotent — safe to call multiple times; only one poller will run.
 * Fires an immediate first fetch then polls every POLL_INTERVAL_MS.
 */
export function startOraclePoller(): void {
  if (_pollerTimer !== null) return;
  _tick().catch(() => {});
  _pollerTimer = setInterval(() => {
    _tick().catch(() => {});
  }, POLL_INTERVAL_MS);
  if (typeof _pollerTimer === 'object' && _pollerTimer !== null && 'unref' in _pollerTimer) {
    (_pollerTimer as NodeJS.Timeout).unref();
  }
}

/**
 * Synchronous O(1) read of the cached USDT/ILS rate.
 * Returns null if the cache is cold or stale (>2 min old).
 * Expert 4 (Macro) must call this — never fetch Binance REST inline during consensus.
 */
export function getUsdtIlsRate(): number | null {
  if (_cache.updatedAtMs === 0) return null;
  if (Date.now() - _cache.updatedAtMs > STALE_THRESHOLD_MS) return null;
  return _cache.usdtIls;
}

/**
 * Async warm-read: if cache is cold/stale, performs one blocking fetch before returning.
 * Use only outside the hot consensus path (e.g. macro context builder, pre-warm on startup).
 */
export async function getUsdtIlsRateAsync(): Promise<number | null> {
  const isStale = _cache.updatedAtMs === 0 || Date.now() - _cache.updatedAtMs > STALE_THRESHOLD_MS;
  if (isStale) {
    await _tick();
  }
  return _cache.usdtIls;
}

/** Expose cache metadata for diagnostics/health endpoints. */
export function getOracleStatus(): { usdtIls: number | null; updatedAtMs: number; stale: boolean; pollerActive: boolean } {
  return {
    usdtIls: _cache.usdtIls,
    updatedAtMs: _cache.updatedAtMs,
    stale: _cache.updatedAtMs === 0 || Date.now() - _cache.updatedAtMs > STALE_THRESHOLD_MS,
    pollerActive: _pollerTimer !== null,
  };
}

// Auto-start the poller when this module is first imported.
startOraclePoller();
