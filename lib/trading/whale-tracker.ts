import { ensureMarketDataProviderOrFallback } from '@/lib/market-data';
export type WhaleWalletType = 'exchange' | 'private' | 'unknown';
export type WhaleMovementDirection = 'inflow_to_exchange' | 'outflow_from_exchange' | 'wallet_to_wallet';

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
    return {
      assetTicker: ticker,
      status: 'AWAITING_LIVE_DATA',
      totalMovements: null,
      severeInflowsToExchanges: null,
      largestMovementUsd: null,
      netExchangeFlowUsd: null,
      generatedAt: new Date().toISOString(),
      movements: [],
      providerNote: `Fallback mode: ${providerGuard.reason || 'CryptoQuant unavailable'}.`,
    };
  }
  const apiKey = (process.env.CRYPTOQUANT_API_KEY || '').trim();
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
      providerNote: 'CRYPTOQUANT_API_KEY is missing.',
    };
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
      return {
        assetTicker: ticker,
        status: 'AWAITING_LIVE_DATA',
        totalMovements: null,
        severeInflowsToExchanges: null,
        largestMovementUsd: null,
        netExchangeFlowUsd: null,
        generatedAt: new Date().toISOString(),
        movements: [],
        providerNote: `CryptoQuant unavailable (netflow=${netflowRes.status}, whaleRatio=${whaleRes.status}).`,
      };
    }
    const [netflowBody, whaleBody] = await Promise.all([netflowRes.json(), whaleRes.json()]);
    const netflowText = JSON.stringify(netflowBody).slice(0, 220);
    const whaleText = JSON.stringify(whaleBody).slice(0, 220);

    return {
      assetTicker: ticker,
      status: 'LIVE',
      totalMovements: null,
      severeInflowsToExchanges: null,
      largestMovementUsd: null,
      netExchangeFlowUsd: null,
      generatedAt: new Date().toISOString(),
      movements: [],
      providerNote: `Live CryptoQuant fetched. netflow=${netflowText}; whaleRatio=${whaleText}`,
    };
  } catch (error) {
    return {
      assetTicker: ticker,
      status: 'AWAITING_LIVE_DATA',
      totalMovements: null,
      severeInflowsToExchanges: null,
      largestMovementUsd: null,
      netExchangeFlowUsd: null,
      generatedAt: new Date().toISOString(),
      movements: [],
      providerNote: `CryptoQuant error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
