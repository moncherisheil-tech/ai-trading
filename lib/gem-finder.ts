/**
 * Gem Finder: filter coins by minimum liquidity and 24h volume.
 * Elite (עוצמתי) signal: Volume Spike + Price > EMA 20 + RSI < 70; bonus: EMA 20 > EMA 50.
 */

import { APP_CONFIG } from '@/lib/config';
import { fetchWithBackoff } from '@/lib/api-utils';
import { rsi, ema20, ema50 } from '@/lib/indicators';

export const MIN_LIQUIDITY_USD = 50_000;
export const MIN_VOLUME_24H_USD = 100_000;

/** Scanner filter options from AppSettings; when not provided, built-in defaults are used. */
export interface GemFinderOptions {
  minVolume24hUsd?: number;
  minLiquidityUsd?: number;
  minPriceChangePct?: number;
}

/** Signal strength: gem quality when volume confirms price move. Reduces noise from price-only moves. */
export type SignalStrength = 'low' | 'medium' | 'high';

export interface Ticker24h {
  symbol: string;
  price: number;
  priceChangePercent: number;
  quoteVolume: number;
  volume: number;
  high: number;
  low: number;
  /** Low/Medium/High based on volume + price move. A "gem" is only strong when there is volume behind the move. */
  signalStrength?: SignalStrength;
}

/** Elite (עוצמתי): Volume Spike (profile) + Price > EMA 20 + RSI < 70; bonus: EMA 20 > EMA 50 (bullish), +10 when Bullish Engulfing. */
export interface Ticker24hElite extends Ticker24h {
  rsi14?: number;
  ema20?: number | null;
  ema50?: number | null;
  /** true when Volume Spike AND Price > EMA20 AND RSI < 70 */
  isElite?: boolean;
  /** true when EMA20 > EMA50 (bullish trend) */
  eliteBonus?: boolean;
  /** true when last two candles form a Bullish Engulfing pattern */
  isBullishEngulfing?: boolean;
  /** +10 when Elite and Bullish Engulfing (added to confidence score) */
  confidenceBonus?: number;
}

interface BinanceTicker24hRow {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  volume: string;
  highPrice: string;
  lowPrice: string;
}

function parseTicker(row: BinanceTicker24hRow): Ticker24h {
  return {
    symbol: row.symbol,
    price: parseFloat(row.lastPrice) || 0,
    priceChangePercent: parseFloat(row.priceChangePercent) || 0,
    quoteVolume: parseFloat(row.quoteVolume) || 0,
    volume: parseFloat(row.volume) || 0,
    high: parseFloat(row.highPrice) || 0,
    low: parseFloat(row.lowPrice) || 0,
  };
}

/**
 * Computes signal strength from volume rank + price change.
 * High = top volume tier AND meaningful price move; reduces noise from price-only moves.
 */
function computeSignalStrength(
  tickers: Ticker24h[],
  index: number
): Ticker24h['signalStrength'] {
  if (tickers.length === 0) return 'low';
  const t = tickers[index]!;
  const absMove = Math.abs(t.priceChangePercent) || 0;
  const volumeRank = 1 - index / Math.max(1, tickers.length);
  const hasVolume = volumeRank >= 1 / 3;
  const strongMove = absMove >= 2;
  const moderateMove = absMove >= 0.5;
  if (hasVolume && strongMove) return 'high';
  if ((hasVolume && moderateMove) || (volumeRank >= 2 / 3 && strongMove))
    return 'medium';
  return 'low';
}

function filterAndSort(
  data: BinanceTicker24hRow[],
  options?: GemFinderOptions
): Ticker24h[] {
  const minVol = options?.minVolume24hUsd ?? MIN_VOLUME_24H_USD;
  const minLiq = options?.minLiquidityUsd ?? MIN_LIQUIDITY_USD;
  const minPriceChg = options?.minPriceChangePct ?? 0;
  const filtered = data
    .filter((row) => row.symbol?.endsWith('USDT'))
    .map(parseTicker)
    .filter(
      (t) =>
        t.quoteVolume >= minVol &&
        t.quoteVolume >= minLiq &&
        Math.abs(t.priceChangePercent) >= minPriceChg
    )
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
  return filtered.map((t, i) => ({
    ...t,
    signalStrength: computeSignalStrength(filtered, i),
  }));
}

/**
 * Fetches 24h ticker from Binance and returns only "gems" matching the given options.
 * Uses AppSettings-derived options when provided (minVolume24hUsd, minPriceChangePct).
 * Uses fetchWithBackoff for 429/418 resilience.
 */
export async function fetchGemsTicker24h(options?: GemFinderOptions): Promise<Ticker24h[]> {
  const url = 'https://api.binance.com/api/v3/ticker/24hr';
  const proxyUrl = APP_CONFIG.proxyBinanceUrl ? `${APP_CONFIG.proxyBinanceUrl}/api/v3/ticker/24hr` : '';
  const fetchUrl = proxyUrl || url;

  try {
    const res = await fetchWithBackoff(fetchUrl, {
      timeoutMs: APP_CONFIG.fetchTimeoutMs,
      maxRetries: 4,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Binance 24h ticker failed: ${res.status}`);
    const data = (await res.json()) as BinanceTicker24hRow[];
    return filterAndSort(data, options);
  } catch (e) {
    if (proxyUrl && e instanceof Error && e.message.includes('failed')) {
      try {
        const fallback = await fetch(url, { cache: 'no-store' }).then((r) => r.json() as Promise<BinanceTicker24hRow[]>);
        return filterAndSort(fallback, options);
      } catch {
        throw e;
      }
    }
    throw e;
  }
}

/**
 * Returns base symbols (e.g. BTC) that pass the Gem Finder filter.
 */
export async function getGemBaseSymbols(options?: GemFinderOptions): Promise<string[]> {
  const tickers = await fetchGemsTicker24h(options);
  return tickers.map((t) => t.symbol.replace('USDT', ''));
}

const KLINES_LIMIT = 60; // enough for EMA50
const VOLUME_PROFILE_PERIODS = 20;
const VOLUME_SPIKE_MULTIPLIER = 2.5;

/** Klines row: [openTime, open, high, low, close, volume]. */
type KlineRow = [number, string, string, string, string, string];

async function fetchKlines(symbol: string): Promise<{ closes: number[]; opens: number[]; quoteVolumes: number[] }> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${KLINES_LIMIT}`;
  const res = await fetchWithBackoff(url, { timeoutMs: APP_CONFIG.fetchTimeoutMs, maxRetries: 3, cache: 'no-store' });
  if (!res.ok) return { closes: [], opens: [], quoteVolumes: [] };
  const data = (await res.json()) as KlineRow[];
  const closes: number[] = [];
  const opens: number[] = [];
  const quoteVolumes: number[] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const open = parseFloat(row[1]!);
    const close = parseFloat(row[4]!);
    const vol = parseFloat(row[5]!);
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
    opens.push(open);
    closes.push(close);
    quoteVolumes.push(vol * ((open + close) / 2));
  }
  return { closes, opens, quoteVolumes };
}

/**
 * Volume profile: High Strength when CurrentVolume > AvgVolume(20) × 2.5.
 */
function isVolumeSpike(currentQuoteVolume: number, quoteVolumes: number[]): boolean {
  if (quoteVolumes.length < VOLUME_PROFILE_PERIODS) return false;
  const last20 = quoteVolumes.slice(-VOLUME_PROFILE_PERIODS);
  const avg = last20.reduce((a, b) => a + b, 0) / VOLUME_PROFILE_PERIODS;
  return avg > 0 && currentQuoteVolume > avg * VOLUME_SPIKE_MULTIPLIER;
}

/**
 * Bullish Engulfing: prev candle red (close < open), current green (close > open),
 * current body engulfs previous body: open2 <= close1, close2 >= open1.
 */
function isBullishEngulfing(opens: number[], closes: number[]): boolean {
  if (opens.length < 2 || closes.length < 2) return false;
  const o1 = opens[opens.length - 2]!;
  const c1 = closes[closes.length - 2]!;
  const o2 = opens[opens.length - 1]!;
  const c2 = closes[closes.length - 1]!;
  const prevRed = c1 < o1;
  const currGreen = c2 > o2;
  const engulfs = o2 <= c1 && c2 >= o1 && c2 > o1 && o2 < c1;
  return prevRed && currGreen && engulfs;
}

/**
 * Elite signal: Volume Spike (profile: current > avg20 × 2.5) AND Price > EMA 20 AND RSI < 70.
 * Bonus: EMA 20 > EMA 50 (bullish trend). +10 confidence when Bullish Engulfing.
 */
function computeEliteFromIndicators(
  price: number,
  volumeSpike: boolean,
  rsi14: number,
  ema20Val: number | null,
  ema50Val: number | null,
  engulfing: boolean
): { isElite: boolean; eliteBonus: boolean; confidenceBonus: number } {
  const priceAboveEma20 = ema20Val != null && price > ema20Val;
  const rsiNotOverbought = rsi14 < 70;
  const isElite = volumeSpike && priceAboveEma20 && rsiNotOverbought;
  const eliteBonus = ema20Val != null && ema50Val != null && ema20Val > ema50Val;
  const confidenceBonus = isElite && engulfing ? 10 : 0;
  return { isElite, eliteBonus, confidenceBonus };
}

/**
 * Fetches gems with Elite (עוצמתי) enrichment for top N by volume.
 * A gem is Elite when: Volume Spike AND Price > EMA 20 AND RSI < 70. Bonus: EMA 20 > EMA 50.
 */
export async function fetchGemsTicker24hWithElite(
  options?: GemFinderOptions,
  topN = 40
): Promise<Ticker24hElite[]> {
  const tickers = await fetchGemsTicker24h(options);
  const toEnrich = tickers.slice(0, topN);
  const enriched: Ticker24hElite[] = [];

  for (const t of toEnrich) {
    const { closes, opens, quoteVolumes } = await fetchKlines(t.symbol);
    if (closes.length < 50) {
      enriched.push({ ...t });
      continue;
    }
    const volumeSpike = isVolumeSpike(t.quoteVolume, quoteVolumes);
    const engulfing = isBullishEngulfing(opens, closes);
    const rsi14 = rsi(closes, 14);
    const ema20Val = ema20(closes);
    const ema50Val = ema50(closes);
    const { isElite, eliteBonus, confidenceBonus } = computeEliteFromIndicators(
      t.price,
      volumeSpike,
      rsi14,
      ema20Val,
      ema50Val,
      engulfing
    );
    enriched.push({
      ...t,
      rsi14,
      ema20: ema20Val ?? undefined,
      ema50: ema50Val ?? undefined,
      isElite,
      eliteBonus,
      isBullishEngulfing: engulfing,
      confidenceBonus,
    });
  }

  const rest = tickers.slice(topN).map((t) => ({ ...t } as Ticker24hElite));
  return [...enriched, ...rest];
}
