/**
 * Binance API resilience: rate-limit detection (429, 418), Retry-After, exponential backoff.
 * Use for all server-side Binance REST calls to avoid IP bans.
 */

import { ensureTwelveDataConnection, getTwelveDataUsdIlsSnapshot } from '@/lib/market/forex';
import { APP_CONFIG } from '@/lib/config';

const BINANCE_429 = 429;
const BINANCE_418 = 418; // IP auto-banned

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RETRIES = 4;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;

export interface FetchWithBackoffOptions {
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Max retry attempts (including initial request). */
  maxRetries?: number;
  /** Cache mode for fetch. */
  cache?: RequestCache;
  /** Merged into fetch (signal is always set by the wrapper). */
  init?: Omit<RequestInit, 'signal' | 'cache'>;
}

/**
 * Fetches with exponential backoff. Retries on 429, 418, and 5xx:
 * - Reads Retry-After header (seconds) when present and waits (capped at maxDelayMs).
 * - Otherwise uses exponential backoff: baseDelay * 2^attempt, capped at maxDelayMs.
 * - Does not retry on other 4xx. Network/abort errors retry like transient failures.
 */
export async function fetchWithBackoff(
  url: string,
  options: FetchWithBackoffOptions = {}
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    cache = 'no-store',
    init: extraInit,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...extraInit, cache, signal: controller.signal });
      clearTimeout(timeoutId);

      const isRateLimited = res.status === BINANCE_429 || res.status === BINANCE_418;
      const isServerError = res.status >= 500 && res.status <= 599;
      if (!res.ok && !isRateLimited && !isServerError) {
        throw new Error(`Request failed: ${res.status}`);
      }

      if ((isRateLimited || isServerError) && attempt < maxRetries - 1) {
        let waitMs = BASE_DELAY_MS * Math.pow(2, attempt);
        const retryAfter = res.headers.get('Retry-After');
        if (retryAfter != null) {
          const parsed = parseInt(retryAfter, 10);
          if (Number.isFinite(parsed)) {
            waitMs = Math.min(parsed * 1000, MAX_DELAY_MS);
          }
        }
        waitMs = Math.min(waitMs, MAX_DELAY_MS);
        const waitSec = (waitMs / 1000).toFixed(1);
        if (typeof console !== 'undefined' && console.warn) {
          const label = isRateLimited ? 'Rate limit' : 'Server error';
          console.warn(`[fetchWithBackoff] ${label} (${res.status}), backing off for ${waitSec} seconds.`);
        }
        const jitter = Math.min(400, attempt * 100);
        await new Promise((r) => setTimeout(r, waitMs + jitter));
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err instanceof Error ? err : new Error(String(err));
      const isAbort = lastError.name === 'AbortError';
      if (attempt < maxRetries - 1 && (isAbort || /timeout|network|ECONNRESET/i.test(lastError.message))) {
        const waitMs = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        const jitter = Math.min(400, attempt * 100);
        await new Promise((r) => setTimeout(r, waitMs + jitter));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error('fetchWithBackoff failed');
}

/**
 * Fetches Binance ticker/price for given symbols. Returns symbol -> price map.
 * Uses fetchWithBackoff and tolerates partial failure (returns only valid prices).
 */
export async function fetchBinanceTickerPrices(
  symbols: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Map<string, number>> {
  const uniq = [...new Set(symbols)].filter(Boolean);
  if (uniq.length === 0) return new Map();

  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(uniq))}`;

  try {
    const res = await fetchWithBackoff(url, { timeoutMs, maxRetries: 4, cache: 'no-store' });
    if (!res.ok) return new Map();
    const data = (await res.json()) as Array<{ symbol?: string; price?: string }>;
    const map = new Map<string, number>();
    for (const row of data) {
      if (row.symbol && row.price) {
        const p = parseFloat(row.price);
        if (Number.isFinite(p) && p > 0) map.set(row.symbol, p);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Fetches Binance Futures mark prices for given symbols. Returns symbol -> markPrice map.
 * Falls back silently per symbol (partial map is valid).
 */
export async function fetchBinanceMarkPrices(
  symbols: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Map<string, number>> {
  const uniq = [...new Set(symbols)].filter(Boolean);
  if (uniq.length === 0) return new Map();
  const base = 'https://fapi.binance.com';
  const out = new Map<string, number>();
  await Promise.all(
    uniq.map(async (symbol) => {
      const url = `${base}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`;
      try {
        const res = await fetchWithBackoff(url, { timeoutMs, maxRetries: 3, cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { symbol?: string; markPrice?: string };
        const price = Number.parseFloat(data.markPrice ?? '');
        if (data.symbol && Number.isFinite(price) && price > 0) {
          out.set(data.symbol, price);
        }
      } catch {
        // Skip failed symbol; caller can fallback to ticker/entry.
      }
    })
  );
  return out;
}

/** Binance depth response: bids/asks arrays of [price, qty]. */
export interface BinanceDepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

/**
 * Fetches Binance spot Order Book depth for a symbol.
 * Uses /api/v3/depth?symbol=...&limit=50 for institutional-grade depth context.
 */
export async function fetchBinanceOrderBookDepth(
  symbol: string,
  limit: number = 50,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<BinanceDepthSnapshot | null> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const normalized = symbol.toUpperCase().trim().endsWith('USDT') ? symbol : `${symbol}USDT`;
  const url = `${base.replace(/\/$/, '')}/api/v3/depth?symbol=${encodeURIComponent(normalized)}&limit=${Math.min(100, Math.max(5, limit))}`;
  try {
    const res = await fetchWithBackoff(url, { timeoutMs, maxRetries: 3, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as BinanceDepthSnapshot;
    if (data?.bids && Array.isArray(data.bids) && data?.asks && Array.isArray(data.asks)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Summarizes order book depth into a short string for the Macro/Technician expert.
 * Bid vs ask imbalance and top levels.
 */
export function summarizeOrderBookDepth(depth: BinanceDepthSnapshot | null, symbol: string): string {
  if (!depth || (!depth.bids?.length && !depth.asks?.length)) {
    return `Order book depth not available for ${symbol}.`;
  }
  const bids = depth.bids.slice(0, 10);
  const asks = depth.asks.slice(0, 10);
  let bidVol = 0;
  let askVol = 0;
  for (const [, q] of bids) bidVol += parseFloat(q);
  for (const [, q] of asks) askVol += parseFloat(q);
  const total = bidVol + askVol;
  const bidPct = total > 0 ? ((bidVol / total) * 100).toFixed(1) : '50';
  const bestBid = bids[0]?.[0] ?? '—';
  const bestAsk = asks[0]?.[0] ?? '—';
  const spread = bids[0]?.[0] && asks[0]?.[0]
    ? (parseFloat(asks[0][0]) - parseFloat(bids[0][0])).toFixed(4)
    : '—';
  return `Order book (${symbol}): best bid ${bestBid}, best ask ${bestAsk}, spread ${spread}. Bid/Ask volume ratio (top 10): ${bidPct}% bids. ${bidVol > askVol ? 'Bid-heavy.' : askVol > bidVol ? 'Ask-heavy.' : 'Balanced.'}`;
}

/** Binance /api/v3/aggTrades row (subset of fields used for CVD). */
export interface BinanceAggTradeRow {
  p?: string;
  q?: string;
  T?: number;
  m?: boolean;
}

/** Normalized trade for Signal Core (aggressor-signed CVD convention matches Python). */
export interface NormalizedAggTrade {
  price: number;
  qty: number;
  is_buyer_maker: boolean;
  time: number;
}

/**
 * Maps raw aggTrades JSON to strict numeric payloads. Drops invalid rows.
 * Binance: m=true => buyer was maker => seller aggressor.
 */
export function normalizeBinanceAggTrades(rows: unknown): NormalizedAggTrade[] {
  if (!Array.isArray(rows)) return [];
  const out: NormalizedAggTrade[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const o = row as BinanceAggTradeRow;
    const price = Number.parseFloat(String(o.p ?? ''));
    const qty = Number.parseFloat(String(o.q ?? ''));
    const time = typeof o.T === 'number' ? o.T : Number(o.T);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty < 0 || !Number.isFinite(time)) {
      continue;
    }
    out.push({
      price,
      qty,
      is_buyer_maker: Boolean(o.m),
      time: Math.round(time),
    });
  }
  return out;
}

/**
 * Fetches Binance spot aggregate trades (recent window). Max limit 1000.
 * Uses same proxy base and backoff as order book.
 */
export async function fetchBinanceAggTrades(
  symbol: string,
  limit: number = 500,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<NormalizedAggTrade[]> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const sym = symbol.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
  const normalized = sym.endsWith('USDT') ? sym : `${sym}USDT`;
  const lim = Math.min(1000, Math.max(1, Math.floor(limit)));
  const url = `${base.replace(/\/$/, '')}/api/v3/aggTrades?symbol=${encodeURIComponent(normalized)}&limit=${lim}`;
  try {
    const res = await fetchWithBackoff(url, { timeoutMs, maxRetries: 3, cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return normalizeBinanceAggTrades(data);
  } catch {
    return [];
  }
}

/** Basic macro context: DXY proxy or sentiment for Macro expert. */
export interface MacroContextSnapshot {
  dxyNote: string;
  dxyValue?: number;
  dxySource?: string;
  dxyStatus?: 'ok' | 'fail';
  fearGreedIndex?: number;
  fearGreedLabel?: string;
  btcDominancePct?: number;
  updatedAt: string;
}

export async function fetchDxySnapshot(timeoutMs: number): Promise<{ value: number; source: string } | null> {
  const sources = [
    {
      source: 'stooq',
      url: 'https://stooq.com/q/l/?s=dx-y.n&f=sd2t2ohlcv&h&e=csv',
      parse: (raw: string): number | null => {
        const lines = raw.trim().split(/\r?\n/);
        if (lines.length < 2) return null;
        const row = lines[1]?.split(',') ?? [];
        const close = Number.parseFloat((row[6] ?? '').trim());
        return Number.isFinite(close) && close > 0 ? close : null;
      },
    },
    {
      source: 'yahoo-chart',
      url: 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=1d&interval=1m',
      parse: (raw: string): number | null => {
        const data = JSON.parse(raw) as {
          chart?: {
            result?: Array<{
              meta?: { regularMarketPrice?: number };
              indicators?: { quote?: Array<{ close?: Array<number | null> }> };
            }>;
          };
        };
        const result = data.chart?.result?.[0];
        const direct = result?.meta?.regularMarketPrice;
        if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
        const closes = result?.indicators?.quote?.[0]?.close ?? [];
        for (let i = closes.length - 1; i >= 0; i--) {
          const v = closes[i];
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
        }
        return null;
      },
    },
  ];

  for (const src of sources) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(src.url, {
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json,text/csv;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0',
        },
      });
      if (!res.ok) continue;
      const text = await res.text();
      const value = src.parse(text);
      if (value != null) {
        return { value: Math.round(value * 1000) / 1000, source: src.source };
      }
    } catch {
      // Try next source.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

/**
 * Fetches basic macro/sentiment context for the Macro expert (DXY proxy, Fear & Greed, BTC dominance).
 * Uses public APIs where available so the Macro expert has real data instead of "Missing Data".
 */
export async function fetchMacroContext(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<MacroContextSnapshot> {
  const updatedAt = new Date().toISOString();
  const out: MacroContextSnapshot = { dxyNote: 'DXY (US Dollar Index) unavailable this cycle.', updatedAt };

  try {
    const [dxySnapshot, fngRes, dominanceRes] = await Promise.all([
      fetchDxySnapshot(timeoutMs).catch(() => null),
      fetchWithBackoff('https://api.alternative.me/fng/?limit=1', {
        timeoutMs,
        maxRetries: 3,
        cache: 'no-store',
      }).catch(() => null),
      fetchWithBackoff('https://api.coingecko.com/api/v3/global', {
        timeoutMs,
        maxRetries: 3,
        cache: 'no-store',
      }).catch(() => null),
    ]);

    if (dxySnapshot) {
      out.dxyValue = dxySnapshot.value;
      out.dxySource = dxySnapshot.source;
      out.dxyStatus = 'ok';
      out.dxyNote = `DXY live: ${dxySnapshot.value.toFixed(3)} (source: ${dxySnapshot.source}).`;
    } else {
      out.dxyStatus = 'fail';
      out.dxySource = 'none';
    }

    if (fngRes?.ok) {
      const fngData = (await fngRes.json()) as { data?: Array<{ value?: string; value_classification?: string }> };
      const first = fngData?.data?.[0];
      if (first?.value) {
        const val = parseInt(first.value, 10);
        if (Number.isFinite(val)) {
          out.fearGreedIndex = val;
          out.fearGreedLabel = first.value_classification ?? (val <= 25 ? 'Extreme Fear' : val >= 75 ? 'Extreme Greed' : 'Neutral');
        }
      }
    }

    if (dominanceRes?.ok) {
      const domData = (await dominanceRes.json()) as { data?: { market_cap_percentage?: Record<string, number> } };
      const btc = domData?.data?.market_cap_percentage?.btc;
      if (typeof btc === 'number' && Number.isFinite(btc)) {
        out.btcDominancePct = Math.round(btc * 10) / 10;
      }
    }

    const parts: string[] = [];
    if (out.fearGreedIndex != null) parts.push(`Fear & Greed: ${out.fearGreedIndex} (${out.fearGreedLabel ?? 'N/A'})`);
    if (out.btcDominancePct != null) parts.push(`BTC dominance: ${out.btcDominancePct}%`);
    if (parts.length > 0) {
      out.dxyNote = `Market sentiment: ${parts.join('; ')}. ${out.dxyNote}`;
    }
  } catch {
    // Keep default dxyNote
  }
  return out;
}

export type ForexUplinkSnapshot = {
  dxy?: number;
  eurUsd?: number;
  usdIls?: number;
  updatedAt: string;
};

function parseYahooChartLastClose(raw: string): number | null {
  try {
    const data = JSON.parse(raw) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number }; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
    };
    const result = data.chart?.result?.[0];
    const direct = result?.meta?.regularMarketPrice;
    if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const v = closes[i];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Live DXY, EUR/USD, USD/ILS for macro panel and localized ILS risk (Yahoo chart endpoints).
 */
export async function fetchForexUplink(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ForexUplinkSnapshot> {
  const updatedAt = new Date().toISOString();
  const out: ForexUplinkSnapshot = { updatedAt };
  const symbols = [
    { key: 'dxy' as const, yahoo: 'DX-Y.NYB' },
    { key: 'eurUsd' as const, yahoo: 'EURUSD=X' },
    { key: 'usdIls' as const, yahoo: 'ILS=X' },
  ];
  await Promise.all(
    symbols.map(async ({ key, yahoo }) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=1d&interval=5m`;
        const res = await fetchWithBackoff(url, {
          timeoutMs,
          maxRetries: 3,
          cache: 'no-store',
          init: {
            headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
          },
        });
        if (!res.ok) return;
        const text = await res.text();
        const v = parseYahooChartLastClose(text);
        if (v == null) return;
        const rounded = Math.round(v * 10_000) / 10_000;
        // Reject cross-ticker garbage (e.g. wrong slot) so DXY / FX pairs never mix scales.
        if (key === 'dxy' && (rounded < 72 || rounded > 140)) return;
        if (key === 'eurUsd' && (rounded < 0.65 || rounded > 1.65)) return;
        if (key === 'usdIls' && (rounded < 2 || rounded > 8)) return;
        out[key] = rounded;
      } catch {
        // skip symbol
      }
    })
  );
  const dxySnap = await fetchDxySnapshot(timeoutMs).catch(() => null);
  if (dxySnap && out.dxy == null) {
    const v = dxySnap.value;
    if (v >= 72 && v <= 140) out.dxy = v;
  }
  try {
    ensureTwelveDataConnection();
    const live = getTwelveDataUsdIlsSnapshot();
    if (live && Number.isFinite(live.price)) {
      out.usdIls = live.price;
    }
  } catch {
    /* live FX optional */
  }
  return out;
}

