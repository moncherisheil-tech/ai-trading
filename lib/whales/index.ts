/**
 * Whale-tracking orchestrator — provider priority chain:
 *
 *   1. CryptoQuant  (legacy primary; known-broken on 2026 API paths → fast fail)
 *   2. Whale Alert  (NEW primary; real-time on-chain transactions ≥$500k)
 *   3. Binance      (public aggTrades proxy — no API key required)
 *
 * The result type is identical to the one returned by lib/trading/whale-tracker.ts
 * so existing callers (analysis-core, consensus-engine) require zero changes.
 */

import { fetchWhaleAlertMovements } from '@/lib/whales/whale-alert-provider';
import type { WhaleMovement, WhaleMovementsResult } from '@/lib/whales/types';

// ── Constants ──────────────────────────────────────────────────────────────
/** Binance aggTrade size classified as whale-level. */
const BINANCE_WHALE_THRESHOLD_USD = 100_000;

/** CryptoQuant v1 base (all 2026 paths returning 404 — kept for completeness). */
const CQ_BASE = 'https://api.cryptoquant.com/v1';

// ── CryptoQuant provider (legacy) ─────────────────────────────────────────
async function fetchCryptoQuantMovements(
  ticker: string
): Promise<WhaleMovementsResult> {
  const apiKey = (process.env.CRYPTOQUANT_API_KEY ?? '').trim();
  if (!apiKey) throw new Error('CRYPTOQUANT_API_KEY not set');

  const asset = ticker.toLowerCase();
  const [netflowRes, whaleRes] = await Promise.all([
    fetch(`${CQ_BASE}/${asset}/exchange-flows/netflow`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    }),
    fetch(`${CQ_BASE}/${asset}/flow-indicator/whale-ratio`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    }),
  ]);

  if (!netflowRes.ok || !whaleRes.ok) {
    throw new Error(
      `CryptoQuant HTTP error — netflow=${netflowRes.status}, whaleRatio=${whaleRes.status}`
    );
  }

  const [netflowBody, whaleBody] = (await Promise.all([
    netflowRes.json(),
    whaleRes.json(),
  ])) as [Record<string, unknown>, Record<string, unknown>];

  let netExchangeFlowUsd: number | null = null;
  let severeInflows: number | null = null;

  const nfData = (netflowBody as { result?: { data?: Array<{ value?: unknown }> } })
    ?.result?.data?.[0];
  if (nfData?.value !== undefined) {
    const v = Number(nfData.value);
    if (Number.isFinite(v)) netExchangeFlowUsd = v;
  }

  const wrData = (whaleBody as { result?: { data?: Array<{ value?: unknown }> } })
    ?.result?.data?.[0];
  if (wrData?.value !== undefined) {
    const ratio = Number(wrData.value);
    if (Number.isFinite(ratio)) severeInflows = ratio > 85 ? 1 : 0;
  }

  return {
    assetTicker: ticker,
    status: 'LIVE',
    totalMovements: 1,
    severeInflowsToExchanges: severeInflows,
    largestMovementUsd: netExchangeFlowUsd,
    netExchangeFlowUsd,
    generatedAt: new Date().toISOString(),
    movements: [],
    providerNote: 'CryptoQuant live data.',
  };
}

// ── Binance aggTrades fallback (no API key) ────────────────────────────────
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
      `Binance aggTrades proxy — ${whaleCount} whale trades` +
      ` (≥$${(BINANCE_WHALE_THRESHOLD_USD / 1_000).toFixed(0)}k) from last 500 agg-trades.`,
  };
}

// ── Orchestrator ───────────────────────────────────────────────────────────
/**
 * Resolves whale movements through the provider priority chain.
 * CryptoQuant is attempted first (currently 404 on all 2026 paths) so that
 * it auto-recovers if CQ restores their endpoints. Whale Alert steps in
 * immediately on any CQ failure, followed by the Binance public fallback.
 */
export async function getRecentWhaleMovementsOrchestrated(
  assetTicker: string
): Promise<WhaleMovementsResult> {
  const ticker = assetTicker.toUpperCase().replace(/USDT$/i, '');

  // ── 1. CryptoQuant ────────────────────────────────────────────────────────
  try {
    const result = await fetchCryptoQuantMovements(ticker);
    return result;
  } catch (cqErr) {
    const cqMsg = cqErr instanceof Error ? cqErr.message : String(cqErr);
    const isBroken = /404|000|not found|unavailable|ECONNREFUSED/i.test(cqMsg);
    console.warn(
      `[whale-orchestrator] CryptoQuant ${isBroken ? 'unavailable (known 404)' : 'failed'}: ${cqMsg}` +
      ` — escalating to Whale Alert.`
    );
  }

  // ── 2. Whale Alert ────────────────────────────────────────────────────────
  try {
    const result = await fetchWhaleAlertMovements(ticker);
    if (result.status === 'LIVE') return result;
    // If key is not configured, fall through to Binance silently.
    console.warn(
      '[whale-orchestrator] Whale Alert key not configured — using Binance fallback.'
    );
  } catch (waErr) {
    const waMsg = waErr instanceof Error ? waErr.message : String(waErr);
    console.warn(
      `[whale-orchestrator] Whale Alert failed: ${waMsg} — falling back to Binance.`
    );
  }

  // ── 3. Binance aggTrades fallback ─────────────────────────────────────────
  try {
    return await fetchBinanceFallback(ticker);
  } catch (binErr) {
    const binMsg = binErr instanceof Error ? binErr.message : String(binErr);
    console.error(
      `[whale-orchestrator] All providers failed for ${ticker}. Binance: ${binMsg}`
    );
    return {
      assetTicker: ticker,
      status: 'AWAITING_LIVE_DATA',
      totalMovements: null,
      severeInflowsToExchanges: null,
      largestMovementUsd: null,
      netExchangeFlowUsd: null,
      generatedAt: new Date().toISOString(),
      movements: [],
      providerNote:
        `All whale providers exhausted. CryptoQuant: 404. Whale Alert: failed. Binance: ${binMsg}`,
    };
  }
}
