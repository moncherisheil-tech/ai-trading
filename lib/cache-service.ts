/**
 * Caching layer for Binance ticker data to reduce API calls and avoid rate-limiting.
 * Ticker cache TTL: 5 minutes. Cache key includes scanner options so settings changes take effect on next cycle.
 */

import type { Ticker24h, GemFinderOptions } from '@/lib/gem-finder';
import { fetchGemsTicker24h } from '@/lib/gem-finder';

const TICKER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(options?: GemFinderOptions): string {
  if (!options) return 'default';
  return [
    options.minVolume24hUsd ?? '',
    options.minLiquidityUsd ?? '',
    options.minPriceChangePct ?? '',
  ].join('_');
}

let tickerCache: { data: Ticker24h[]; expiresAt: number; key: string } | null = null;

/**
 * Returns 24h ticker data for gems (liquidity/volume filtered). Uses cache when valid and options match.
 * Pass scanner options from AppSettings so the next scan cycle reflects user-defined thresholds.
 */
export async function getCachedGemsTicker24h(options?: GemFinderOptions): Promise<Ticker24h[]> {
  const now = Date.now();
  const key = cacheKey(options);
  if (tickerCache && tickerCache.expiresAt > now && tickerCache.key === key) {
    return tickerCache.data;
  }
  const data = await fetchGemsTicker24h(options);
  tickerCache = { data, expiresAt: now + TICKER_CACHE_TTL_MS, key };
  return data;
}

/**
 * Invalidate ticker cache (e.g. for testing or manual refresh).
 */
export function invalidateTickerCache(): void {
  tickerCache = null;
}
