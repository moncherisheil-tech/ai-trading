/**
 * Market Data — Internal Pipeline Only.
 *
 * External providers (CryptoQuant, CoinMarketCap) have been decommissioned.
 * All real-time whale signals flow exclusively through the sovereign i9 hardware
 * feed via Redis Pub/Sub (WHALE_REDIS_URL → "quant:alerts" channel).
 * Supplementary market context uses Binance public endpoints (no API key required).
 *
 * This module is retained as a compatibility shim so existing callers compile
 * without modification.  It no longer validates external API keys.
 */

export function getMarketDataProviderStatus() {
  return {
    internalPipeline: { present: true, valid: true },
    binancePublic: { present: true, valid: true },
  };
}

export function ensureMarketDataProviderOrFallback(
  _provider: 'CryptoQuant' | 'CoinMarketCap'
): { enabled: boolean; reason: string | null } {
  return {
    enabled: false,
    reason: `${_provider} decommissioned — all market data flows through the i9 internal pipeline (Redis quant:alerts) and Binance public WebSockets.`,
  };
}
