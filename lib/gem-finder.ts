/**
 * Gem Finder: filter coins by minimum liquidity and 24h volume.
 * Ignore coins with Liquidity < $50k or 24h Volume < $100k.
 */

import { APP_CONFIG } from '@/lib/config';

export const MIN_LIQUIDITY_USD = 50_000;
export const MIN_VOLUME_24H_USD = 100_000;

export interface Ticker24h {
  symbol: string;
  price: number;
  priceChangePercent: number;
  quoteVolume: number;
  volume: number;
  high: number;
  low: number;
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
 * Fetches 24h ticker from Binance and returns only "gems":
 * quoteVolume (24h volume in USDT) >= MIN_VOLUME_24H_USD and
 * quoteVolume as liquidity proxy >= MIN_LIQUIDITY_USD.
 */
export async function fetchGemsTicker24h(): Promise<Ticker24h[]> {
  const url = 'https://api.binance.com/api/v3/ticker/24hr';
  const proxyUrl = APP_CONFIG.proxyBinanceUrl ? `${APP_CONFIG.proxyBinanceUrl}/api/v3/ticker/24hr` : '';

  const fetchUrl = proxyUrl || url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APP_CONFIG.fetchTimeoutMs);

  try {
    const res = await fetch(fetchUrl, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`Binance 24h ticker failed: ${res.status}`);
    const data = (await res.json()) as BinanceTicker24hRow[];
    clearTimeout(timeout);

    return data
      .filter((row) => row.symbol?.endsWith('USDT'))
      .map(parseTicker)
      .filter(
        (t) =>
          t.quoteVolume >= MIN_VOLUME_24H_USD && t.quoteVolume >= MIN_LIQUIDITY_USD
      )
      .sort((a, b) => b.quoteVolume - a.quoteVolume);
  } catch (e) {
    clearTimeout(timeout);
    if (proxyUrl && (e instanceof Error && e.message.includes('failed'))) {
      const fallback = await fetch(url, { cache: 'no-store' }).then((r) => r.json() as Promise<BinanceTicker24hRow[]>);
      return fallback
        .filter((row) => row.symbol?.endsWith('USDT'))
        .map(parseTicker)
        .filter(
          (t) =>
            t.quoteVolume >= MIN_VOLUME_24H_USD && t.quoteVolume >= MIN_LIQUIDITY_USD
        )
        .sort((a, b) => b.quoteVolume - a.quoteVolume);
    }
    throw e;
  }
}

/**
 * Returns base symbols (e.g. BTC) that pass the Gem Finder filter.
 */
export async function getGemBaseSymbols(): Promise<string[]> {
  const tickers = await fetchGemsTicker24h();
  return tickers.map((t) => t.symbol.replace('USDT', ''));
}
