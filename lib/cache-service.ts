/**
 * Caching layer for Binance ticker data to reduce API calls and avoid rate-limiting.
 * Ticker cache TTL: 5 minutes.
 */

import type { Ticker24h } from '@/lib/gem-finder';
import { fetchGemsTicker24h } from '@/lib/gem-finder';

const TICKER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let tickerCache: { data: Ticker24h[]; expiresAt: number } | null = null;

/**
 * Returns 24h ticker data for gems (liquidity/volume filtered). Uses cache when valid.
 */
export async function getCachedGemsTicker24h(): Promise<Ticker24h[]> {
  const now = Date.now();
  if (tickerCache && tickerCache.expiresAt > now) {
    return tickerCache.data;
  }
  const data = await fetchGemsTicker24h();
  tickerCache = { data, expiresAt: now + TICKER_CACHE_TTL_MS };
  return data;
}

/**
 * Invalidate ticker cache (e.g. for testing or manual refresh).
 */
export function invalidateTickerCache(): void {
  tickerCache = null;
}
