/**
 * Whale-data enrichment — Binance aggTrades proxy.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  SOVEREIGN ALERT PIPELINE (primary — event-driven)              │
 * │                                                                  │
 * │  Redis Pub/Sub (88.99.208.99)                                   │
 * │    → lib/redis/whale-subscriber.ts                              │
 * │    → BullMQ  "quantum-core-queue"                               │
 * │    → lib/core/orchestrator.ts  (zero HTTP — processes job.data) │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * This module provides SUPPLEMENTARY per-symbol whale context for
 * lib/analysis-core.ts and lib/alpha-engine.ts.  It is NOT part of
 * the alert-ingestion pipeline — it enriches analysis prompts with
 * recent on-exchange whale-sized trade flow from Binance's public
 * aggTrades endpoint (no API key required).
 *
 * Legacy providers removed (Operation "Clean Slate"):
 *   ✗  Server B HTTP Relay  (WHALE_PROXY_URL)
 *   ✗  CryptoQuant API      (CRYPTOQUANT_API_KEY / CRYPTOQUANT_RELAY_URL)
 *   ✗  Whale Alert API      (WHALE_ALERT_API_KEY / WHALE_ALERT_RELAY_URL)
 *   ✗  CMC price-weighting  (CMC_API_KEY, within this module only)
 */

import type { WhaleMovement, WhaleMovementsResult } from '@/lib/whales/types';

// ── Constants ──────────────────────────────────────────────────────────────
/** Binance aggTrade size classified as whale-level. */
const BINANCE_WHALE_THRESHOLD_USD = 100_000;

// ── Binance aggTrades (public, no API key) ─────────────────────────────────
async function fetchBinanceFallback(ticker: string): Promise<WhaleMovementsResult> {
  const symbol = `${ticker.toUpperCase()}USDT`;
  const url = `https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=500`;
  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);

  const trades = (await res.json()) as Array<{
    p: string;
    q: string;
    m: boolean;
  }>;

  let buyUsd = 0;
  let sellUsd = 0;
  let largestUsd = 0;
  let whaleCount = 0;

  for (const t of trades) {
    const price = parseFloat(t.p);
    const qty = parseFloat(t.q);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
    const tradeUsd = price * qty;
    if (tradeUsd < BINANCE_WHALE_THRESHOLD_USD) continue;

    whaleCount++;
    if (tradeUsd > largestUsd) largestUsd = tradeUsd;
    if (t.m) sellUsd += tradeUsd; else buyUsd += tradeUsd;
  }

  const netFlowUsd = buyUsd - sellUsd;
  const totalVol = buyUsd + sellUsd;
  const severeInflow = totalVol > 0 && sellUsd / totalVol > 0.85;

  const movements: WhaleMovement[] = whaleCount > 0
    ? [{
        assetTicker: ticker,
        transactionHash: `binance-proxy-${Date.now()}`,
        amount: null,
        amountUsdEstimate: largestUsd,
        fromLabel: netFlowUsd < 0 ? 'Large Seller' : 'Large Buyer',
        fromType: 'unknown',
        toLabel: 'Exchange',
        toType: 'exchange',
        direction: netFlowUsd < 0 ? 'inflow_to_exchange' : 'outflow_from_exchange',
        anomalyScore: whaleCount > 10 ? 85 : whaleCount > 5 ? 60 : 35,
        timestamp: new Date().toISOString(),
        narrative:
          `Binance proxy: ${whaleCount} whale trades (≥$${(BINANCE_WHALE_THRESHOLD_USD / 1_000).toFixed(0)}k).` +
          ` Net flow: $${(netFlowUsd / 1_000_000).toFixed(2)}M.`,
        source: 'live',
      }]
    : [];

  return {
    assetTicker: ticker,
    status: 'LIVE',
    totalMovements: whaleCount,
    severeInflowsToExchanges: severeInflow ? 1 : 0,
    largestMovementUsd: largestUsd > 0 ? largestUsd : null,
    netExchangeFlowUsd: netFlowUsd !== 0 ? netFlowUsd : null,
    generatedAt: new Date().toISOString(),
    movements,
    providerNote:
      `Binance aggTrades — ${whaleCount} whale trades` +
      ` (≥$${(BINANCE_WHALE_THRESHOLD_USD / 1_000).toFixed(0)}k) from last 500 agg-trades.`,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Returns recent whale-sized trade context for `assetTicker` using the
 * Binance aggTrades public endpoint (no API key, no external auth).
 *
 * On failure returns an AWAITING_LIVE_DATA stub so callers degrade
 * gracefully without crashing the analysis pipeline.
 *
 * NOTE: This is ENRICHMENT data only.  The alert-ingestion pipeline
 * is sovereign and event-driven — see lib/redis/whale-subscriber.ts.
 */
export async function getRecentWhaleMovementsOrchestrated(
  assetTicker: string
): Promise<WhaleMovementsResult> {
  const ticker = assetTicker.toUpperCase().replace(/USDT$/i, '');
  try {
    return await fetchBinanceFallback(ticker);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[whale-data] Binance aggTrades failed for ${ticker}: ${msg} — returning stub.`);
    return {
      assetTicker: ticker,
      status: 'AWAITING_LIVE_DATA',
      totalMovements: null,
      severeInflowsToExchanges: null,
      largestMovementUsd: null,
      netExchangeFlowUsd: null,
      generatedAt: new Date().toISOString(),
      movements: [],
      providerNote: `Binance aggTrades unavailable: ${msg}`,
    };
  }
}
