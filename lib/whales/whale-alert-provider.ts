/**
 * Whale Alert Provider — real-time on-chain transaction feed.
 *
 * API: https://api.whale-alert.io/v1/transactions
 *   - Auth  : ?api_key=<WHALE_ALERT_API_KEY>
 *   - Filter: ?currency=btc,eth  ?min_value=500000  ?start=<unix_sec>
 *
 * CMC price-weighting: When Whale Alert reports only raw token amount (amount_usd = 0),
 * the live USD value is computed as: amount_tokens × CMC_spot_price.
 * This keeps large BTC/ETH block transfers accurately sized even before
 * Whale Alert's own USD estimator updates.
 */

import { fetchWithBackoff } from '@/lib/api-utils';
import type { WhaleMovement, WhaleMovementsResult } from '@/lib/whales/types';

// ── Constants ─────────────────────────────────────────────────────────────────
/** Minimum USD transfer size classified as a whale transaction. */
export const WHALE_ALERT_MIN_VALUE_USD = 500_000;

/** Look-back window for transaction fetch (seconds). */
const LOOKBACK_SECONDS = 3_600; // 1 hour

const WHALE_ALERT_BASE = 'https://api.whale-alert.io/v1';

/** Maps Whale Alert blockchain names to canonical asset tickers. */
const BLOCKCHAIN_TICKER: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  tron: 'TRX',
  ripple: 'XRP',
  cardano: 'ADA',
  solana: 'SOL',
  dogecoin: 'DOGE',
  litecoin: 'LTC',
  avalanche: 'AVAX',
  polygon: 'MATIC',
};

// ── Whale Alert API types ─────────────────────────────────────────────────────
interface WaEndpoint {
  address: string;
  owner?: string;
  owner_type: 'exchange' | 'unknown' | 'other' | string;
}

interface WaTransaction {
  blockchain: string;
  symbol: string;
  id: string;
  transaction_type: string;
  hash: string;
  from: WaEndpoint;
  to: WaEndpoint;
  timestamp: number;   // unix seconds
  amount: number;      // raw token amount
  amount_usd: number;  // pre-computed USD (may be 0 or missing when freshly indexed)
  transaction_count: number;
}

interface WaResponse {
  result: 'success' | 'error';
  cursor?: string;
  count?: number;
  transactions?: WaTransaction[];
  message?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────
function getApiKey(): string | undefined {
  const key = (process.env.WHALE_ALERT_API_KEY ?? '').trim();
  return key.length >= 8 ? key : undefined;
}

/**
 * Fetches the current CMC spot price for a ticker so we can USD-weight
 * transfers where Whale Alert's own amount_usd is missing or stale.
 * Returns null if CMC_API_KEY is absent or the request fails.
 */
async function fetchCmcSpotPrice(ticker: string): Promise<number | null> {
  const cmcKey = (process.env.CMC_API_KEY ?? '').trim();
  if (!cmcKey) return null;
  try {
    const url =
      `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest` +
      `?symbol=${encodeURIComponent(ticker)}&convert=USD`;
    const res = await fetchWithBackoff(url, {
      timeoutMs: 8_000,
      maxRetries: 2,
      cache: 'no-store',
      init: {
        headers: {
          Accept: 'application/json',
          'X-CMC_PRO_API_KEY': cmcKey,
        },
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Record<string, { quote?: { USD?: { price?: number } } }>;
    };
    const price = Number(json?.data?.[ticker]?.quote?.USD?.price ?? NaN);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

function resolveUsd(tx: WaTransaction, cmcPrice: number | null): number {
  if (tx.amount_usd > 0) return tx.amount_usd;
  if (cmcPrice != null && tx.amount > 0) return tx.amount * cmcPrice;
  return 0;
}

function endpointType(ep: WaEndpoint): WhaleMovement['fromType'] {
  return ep.owner_type === 'exchange' ? 'exchange' : 'unknown';
}

function resolveDirection(tx: WaTransaction): WhaleMovement['direction'] {
  if (tx.to.owner_type === 'exchange') return 'inflow_to_exchange';
  if (tx.from.owner_type === 'exchange') return 'outflow_from_exchange';
  return 'wallet_to_wallet';
}

function anomalyScore(usd: number): number {
  if (usd >= 50_000_000) return 95;
  if (usd >= 10_000_000) return 85;
  if (usd >= 1_000_000) return 65;
  return 35;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Fetch ≥$500k whale transactions for `assetTicker` from Whale Alert.
 * USD values are price-weighted via CMC when Whale Alert's own estimate
 * is stale (amount_usd === 0).
 *
 * Throws on HTTP / API errors so the orchestrator can route to the next
 * provider in the fallback chain.
 */
export async function fetchWhaleAlertMovements(
  assetTicker: string
): Promise<WhaleMovementsResult> {
  const ticker = assetTicker.toUpperCase().replace(/USDT$/i, '');

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      assetTicker: ticker,
      status: 'AWAITING_LIVE_DATA',
      totalMovements: null,
      severeInflowsToExchanges: null,
      largestMovementUsd: null,
      netExchangeFlowUsd: null,
      generatedAt: new Date().toISOString(),
      movements: [],
      providerNote: 'WHALE_ALERT_API_KEY not configured — provider skipped.',
    };
  }

  const startTs = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;
  const symbol = ticker.toLowerCase();

  // Kick off CMC price fetch in parallel with the Whale Alert request.
  const cmcPricePromise = fetchCmcSpotPrice(ticker);

  const url =
    `${WHALE_ALERT_BASE}/transactions` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&min_value=${WHALE_ALERT_MIN_VALUE_USD}` +
    `&start=${startTs}` +
    `&currency=${symbol}` +
    `&limit=100`;

  const res = await fetchWithBackoff(url, {
    timeoutMs: 12_000,
    maxRetries: 2,
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`[Whale Alert] HTTP ${res.status}`);
  }

  const body = (await res.json()) as WaResponse;
  if (body.result !== 'success') {
    throw new Error(`[Whale Alert] API error: ${body.message ?? 'unknown'}`);
  }

  const cmcPrice = await cmcPricePromise;
  const rawTxns = body.transactions ?? [];

  // Filter to the requested ticker by blockchain mapping or symbol field.
  const relevant = rawTxns.filter((tx) => {
    const mapped = BLOCKCHAIN_TICKER[tx.blockchain.toLowerCase()];
    return (mapped ?? tx.symbol.toUpperCase()) === ticker;
  });

  // ── Aggregate sentiment ────────────────────────────────────────────────────
  let inflowUsd = 0;
  let outflowUsd = 0;
  let largestUsd = 0;
  const movements: WhaleMovement[] = [];

  for (const tx of relevant) {
    const usd = resolveUsd(tx, cmcPrice);
    if (usd <= 0) continue;

    if (usd > largestUsd) largestUsd = usd;

    const direction = resolveDirection(tx);
    if (direction === 'inflow_to_exchange') inflowUsd += usd;
    else if (direction === 'outflow_from_exchange') outflowUsd += usd;

    const fromLabel = tx.from.owner ?? tx.from.address.slice(0, 14);
    const toLabel = tx.to.owner ?? tx.to.address.slice(0, 14);

    movements.push({
      assetTicker: ticker,
      transactionHash: tx.hash,
      amount: tx.amount,
      amountUsdEstimate: usd,
      fromLabel,
      fromType: endpointType(tx.from),
      toLabel,
      toType: endpointType(tx.to),
      direction,
      anomalyScore: anomalyScore(usd),
      timestamp: new Date(tx.timestamp * 1_000).toISOString(),
      narrative:
        `Whale Alert: ${tx.amount.toLocaleString()} ${ticker}` +
        ` (~$${(usd / 1_000_000).toFixed(2)}M)` +
        ` from ${fromLabel} → ${toLabel}.`,
      source: 'live',
    });
  }

  // ── Whale Sentiment score ──────────────────────────────────────────────────
  // Positive net = more flowing TO exchanges (bearish pressure).
  // Negative net = more leaving exchanges (accumulation / bullish).
  const netExchangeFlowUsd = inflowUsd - outflowUsd;
  const totalVolume = inflowUsd + outflowUsd;
  const severeInflow =
    totalVolume > 0 && totalVolume > 0
      ? inflowUsd / totalVolume > 0.8
      : false;

  const priceNote =
    cmcPrice != null
      ? ` CMC price-weight: $${cmcPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`
      : '';

  console.log('[WHALE-ALERT] Live feed connected. CryptoQuant in standby.');

  return {
    assetTicker: ticker,
    status: 'LIVE',
    totalMovements: relevant.length,
    severeInflowsToExchanges: severeInflow ? 1 : 0,
    largestMovementUsd: largestUsd > 0 ? largestUsd : null,
    netExchangeFlowUsd: netExchangeFlowUsd !== 0 ? netExchangeFlowUsd : null,
    generatedAt: new Date().toISOString(),
    movements,
    providerNote:
      `Whale Alert (1h, ≥$${(WHALE_ALERT_MIN_VALUE_USD / 1_000).toFixed(0)}k):` +
      ` ${relevant.length} txns.` +
      ` Sentiment — inflow: $${(inflowUsd / 1_000_000).toFixed(2)}M,` +
      ` outflow: $${(outflowUsd / 1_000_000).toFixed(2)}M,` +
      ` net: ${netExchangeFlowUsd >= 0 ? '+' : ''}$${(netExchangeFlowUsd / 1_000_000).toFixed(2)}M.` +
      priceNote,
  };
}
