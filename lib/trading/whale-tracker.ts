import { ensureMarketDataProviderOrFallback } from '@/lib/market-data';

export type WhaleWalletType = 'exchange' | 'private' | 'unknown';
export type WhaleMovementDirection = 'inflow_to_exchange' | 'outflow_from_exchange' | 'wallet_to_wallet';

/** Minimum USD trade size classified as "whale" activity when using the Binance fallback. */
const BINANCE_WHALE_THRESHOLD_USD = 100_000;

export interface WhaleMovement {
  assetTicker: string;
  transactionHash: string;
  amount: number | null;
  amountUsdEstimate: number | null;
  fromLabel: string;
  fromType: WhaleWalletType;
  toLabel: string;
  toType: WhaleWalletType;
  direction: WhaleMovementDirection;
  anomalyScore: number | null;
  timestamp: string;
  narrative: string;
  source: 'live' | 'unavailable';
}

export interface WhaleMovementsResult {
  assetTicker: string;
  status: 'LIVE' | 'AWAITING_LIVE_DATA';
  totalMovements: number | null;
  severeInflowsToExchanges: number | null;
  largestMovementUsd: number | null;
  netExchangeFlowUsd: number | null;
  generatedAt: string;
  movements: WhaleMovement[];
  providerNote: string;
}

function normalizeTicker(assetTicker: string): string {
  const cleaned = (assetTicker || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.endsWith('USDT') ? cleaned.slice(0, -4) : cleaned;
}

export async function getRecentWhaleMovements(assetTicker: string): Promise<WhaleMovementsResult> {
  const ticker = normalizeTicker(assetTicker);
  const providerGuard = ensureMarketDataProviderOrFallback('CryptoQuant');
  if (!providerGuard.enabled) {
    console.warn(`[whale-tracker] CryptoQuant guard disabled (${providerGuard.reason}), using Binance fallback.`);
    return getBinanceWhaleFallback(ticker);
  }
  const apiKey = (process.env.CRYPTOQUANT_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[whale-tracker] CRYPTOQUANT_API_KEY missing, using Binance fallback.');
    return getBinanceWhaleFallback(ticker);
  }

  const asset = ticker.toLowerCase();
  const netflowUrl = `https://api.cryptoquant.com/v1/${asset}/exchange-flows/netflow`;
  const whaleUrl = `https://api.cryptoquant.com/v1/${asset}/flow-indicator/whale-ratio`;

  try {
    const [netflowRes, whaleRes] = await Promise.all([
      fetch(netflowUrl, { cache: 'no-store', headers: { Authorization: `Bearer ${apiKey}` } }),
      fetch(whaleUrl, { cache: 'no-store', headers: { Authorization: `Bearer ${apiKey}` } }),
    ]);
    if (!netflowRes.ok || !whaleRes.ok) {
      console.warn(`[whale-tracker] CryptoQuant HTTP error (netflow=${netflowRes.status}, whaleRatio=${whaleRes.status}), using Binance fallback.`);
      return getBinanceWhaleFallback(ticker);
    }
    const [netflowBody, whaleBody] = await Promise.all([netflowRes.json(), whaleRes.json()]);

    let netExchangeFlowUsdValue: number | null = null;
    let severeInflowsValue: number | null = null;
    let providerNote = 'Live CryptoQuant data fetched.';

    try {
      if (netflowBody?.result?.data?.[0]?.value !== undefined) {
        const rawNetflow = netflowBody.result.data[0].value;
        netExchangeFlowUsdValue = typeof rawNetflow === 'number' ? rawNetflow : parseFloat(String(rawNetflow));
      }
    } catch {
      providerNote += ' [netflow parse failed]';
    }

    try {
      if (whaleBody?.result?.data?.[0]?.value !== undefined) {
        const rawWhaleRatio = whaleBody.result.data[0].value;
        const whaleRatioPercent = typeof rawWhaleRatio === 'number' ? rawWhaleRatio : parseFloat(String(rawWhaleRatio));
        severeInflowsValue = whaleRatioPercent > 85 ? 1 : 0;
      }
    } catch {
      providerNote += ' [whale-ratio parse failed]';
    }

    return {
      assetTicker: ticker,
      status: 'LIVE',
      totalMovements: 1,
      severeInflowsToExchanges: severeInflowsValue,
      largestMovementUsd: netExchangeFlowUsdValue,
      netExchangeFlowUsd: netExchangeFlowUsdValue,
      generatedAt: new Date().toISOString(),
      movements: [],
      providerNote,
    };
  } catch (error) {
    console.warn(`[whale-tracker] CryptoQuant failed for ${ticker}, trying Binance fallback:`, error instanceof Error ? error.message : error);
    return getBinanceWhaleFallback(ticker);
  }
}

/**
 * Multi-source fallback: synthesise whale-proxy signals from Binance public aggTrades.
 * Identifies large individual trades (> BINANCE_WHALE_THRESHOLD_USD) as whale activity.
 * Does not require any API key — uses the public Binance REST endpoint.
 */
async function getBinanceWhaleFallback(ticker: string): Promise<WhaleMovementsResult> {
  const symbol = `${ticker.toUpperCase()}USDT`;
  try {
    const url = `https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=500`;
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);

    const trades = (await res.json()) as Array<{
      p: string;  // price
      q: string;  // quantity
      m: boolean; // maker side (true = sell, false = buy)
    }>;

    let totalWhaleUsd = 0;
    let largestTradeUsd = 0;
    let buyPressureUsd = 0;
    let sellPressureUsd = 0;
    let whaleCount = 0;

    for (const t of trades) {
      const price = parseFloat(t.p);
      const qty = parseFloat(t.q);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
      const tradeUsd = price * qty;
      if (tradeUsd >= BINANCE_WHALE_THRESHOLD_USD) {
        whaleCount++;
        totalWhaleUsd += tradeUsd;
        if (tradeUsd > largestTradeUsd) largestTradeUsd = tradeUsd;
        if (t.m) {
          sellPressureUsd += tradeUsd;
        } else {
          buyPressureUsd += tradeUsd;
        }
      }
    }

    const netFlowUsd = buyPressureUsd - sellPressureUsd;
    const isSevereInflow = sellPressureUsd > 0 && sellPressureUsd / (buyPressureUsd + sellPressureUsd) > 0.85;

    const synthesizedMovements: WhaleMovement[] = whaleCount > 0
      ? [{
          assetTicker: ticker,
          transactionHash: `binance-proxy-${Date.now()}`,
          amount: null,
          amountUsdEstimate: largestTradeUsd,
          fromLabel: netFlowUsd < 0 ? 'Large Seller' : 'Large Buyer',
          fromType: 'unknown',
          toLabel: 'Exchange',
          toType: 'exchange',
          direction: netFlowUsd < 0 ? 'inflow_to_exchange' : 'outflow_from_exchange',
          anomalyScore: whaleCount > 10 ? 85 : whaleCount > 5 ? 60 : 35,
          timestamp: new Date().toISOString(),
          narrative: `Binance proxy: ${whaleCount} whale-size trades detected (≥$${(BINANCE_WHALE_THRESHOLD_USD / 1000).toFixed(0)}k). Net flow: $${(netFlowUsd / 1_000_000).toFixed(2)}M.`,
          source: 'live',
        }]
      : [];

    return {
      assetTicker: ticker,
      status: 'LIVE',
      totalMovements: whaleCount,
      severeInflowsToExchanges: isSevereInflow ? 1 : 0,
      largestMovementUsd: largestTradeUsd > 0 ? largestTradeUsd : null,
      netExchangeFlowUsd: netFlowUsd !== 0 ? netFlowUsd : null,
      generatedAt: new Date().toISOString(),
      movements: synthesizedMovements,
      providerNote: `Binance aggTrades fallback — ${whaleCount} whale trades (≥$${(BINANCE_WHALE_THRESHOLD_USD / 1000).toFixed(0)}k) from last 500 agg-trades.`,
    };
  } catch (fallbackError) {
    return {
      assetTicker: ticker,
      status: 'AWAITING_LIVE_DATA',
      totalMovements: null,
      severeInflowsToExchanges: null,
      largestMovementUsd: null,
      netExchangeFlowUsd: null,
      generatedAt: new Date().toISOString(),
      movements: [],
      providerNote: `All providers failed. CryptoQuant unavailable; Binance fallback error: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
    };
  }
}
