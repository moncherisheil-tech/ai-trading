export type WhaleWalletType = 'exchange' | 'private' | 'unknown';
export type WhaleMovementDirection = 'inflow_to_exchange' | 'outflow_from_exchange' | 'wallet_to_wallet';

export interface WhaleMovement {
  assetTicker: string;
  transactionHash: string;
  amount: number;
  amountUsdEstimate: number;
  fromLabel: string;
  fromType: WhaleWalletType;
  toLabel: string;
  toType: WhaleWalletType;
  direction: WhaleMovementDirection;
  anomalyScore: number;
  timestamp: string;
  narrative: string;
  source: 'simulation';
}

export interface WhaleMovementsResult {
  assetTicker: string;
  totalMovements: number;
  severeInflowsToExchanges: number;
  largestMovementUsd: number;
  netExchangeFlowUsd: number;
  generatedAt: string;
  movements: WhaleMovement[];
}

const EXCHANGE_LABELS = ['Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'Bitfinex'];
const PRIVATE_LABELS = ['Unknown Whale Wallet', 'Cold Wallet', 'Custody Vault', 'Institutional Wallet'];

const BASE_PRICE_USD: Record<string, number> = {
  BTC: 68_000,
  ETH: 3_400,
  SOL: 165,
  XRP: 0.6,
  ADA: 0.45,
  DOGE: 0.16,
};

function normalizeTicker(assetTicker: string): string {
  const cleaned = (assetTicker || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.endsWith('USDT') ? cleaned.slice(0, -4) : cleaned;
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pseudoHash(): string {
  const chars = 'abcdef0123456789';
  let out = '0x';
  for (let i = 0; i < 64; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function pickAmountRange(ticker: string): number {
  if (ticker === 'BTC') return randomInt(250, 9_000);
  if (ticker === 'ETH') return randomInt(1_500, 65_000);
  if (ticker === 'SOL') return randomInt(20_000, 600_000);
  return randomInt(5_000, 1_000_000);
}

function calcDirection(fromType: WhaleWalletType, toType: WhaleWalletType): WhaleMovementDirection {
  if (toType === 'exchange' && fromType !== 'exchange') return 'inflow_to_exchange';
  if (fromType === 'exchange' && toType !== 'exchange') return 'outflow_from_exchange';
  return 'wallet_to_wallet';
}

export async function getRecentWhaleMovements(assetTicker: string): Promise<WhaleMovementsResult> {
  const ticker = normalizeTicker(assetTicker);
  const basePrice = BASE_PRICE_USD[ticker] ?? 1;
  const movementCount = randomInt(4, 8);
  const now = Date.now();

  const movements: WhaleMovement[] = Array.from({ length: movementCount }).map((_, idx) => {
    const fromType = Math.random() > 0.45 ? 'private' : 'exchange';
    const toType = Math.random() > 0.52 ? 'exchange' : 'private';
    const direction = calcDirection(fromType, toType);
    const amount = pickAmountRange(ticker);
    const amountUsdEstimate = Math.round(amount * basePrice);
    const anomalyScore = Math.min(100, Math.round(40 + Math.log10(Math.max(amountUsdEstimate, 1)) * 8 + Math.random() * 18));
    const fromLabel = fromType === 'exchange' ? pickOne(EXCHANGE_LABELS) : pickOne(PRIVATE_LABELS);
    const toLabel = toType === 'exchange' ? pickOne(EXCHANGE_LABELS) : pickOne(PRIVATE_LABELS);
    const timestamp = new Date(now - idx * randomInt(8, 35) * 60_000).toISOString();
    const narrative =
      direction === 'inflow_to_exchange'
        ? `${amount.toLocaleString()} ${ticker} moved to ${toLabel} (potential sell pressure).`
        : direction === 'outflow_from_exchange'
          ? `${amount.toLocaleString()} ${ticker} withdrawn from ${fromLabel} (possible accumulation).`
          : `${amount.toLocaleString()} ${ticker} shifted between private entities.`;

    return {
      assetTicker: ticker,
      transactionHash: pseudoHash(),
      amount,
      amountUsdEstimate,
      fromLabel,
      fromType,
      toLabel,
      toType,
      direction,
      anomalyScore,
      timestamp,
      narrative,
      source: 'simulation',
    };
  });

  const severeInflowsToExchanges = movements.filter(
    (m) => m.direction === 'inflow_to_exchange' && m.amountUsdEstimate >= 100_000_000
  ).length;
  const largestMovementUsd = Math.max(...movements.map((m) => m.amountUsdEstimate), 0);
  const netExchangeFlowUsd = movements.reduce((sum, m) => {
    if (m.direction === 'inflow_to_exchange') return sum + m.amountUsdEstimate;
    if (m.direction === 'outflow_from_exchange') return sum - m.amountUsdEstimate;
    return sum;
  }, 0);

  return {
    assetTicker: ticker,
    totalMovements: movements.length,
    severeInflowsToExchanges,
    largestMovementUsd,
    netExchangeFlowUsd,
    generatedAt: new Date().toISOString(),
    movements,
  };
}
