/**
 * Shared type definitions for the whale-tracking pipeline.
 * Imported by all providers (Whale Alert, CryptoQuant, Binance fallback)
 * and re-exported from lib/trading/whale-tracker.ts for backward compatibility.
 */

export type WhaleWalletType = 'exchange' | 'private' | 'unknown';
export type WhaleMovementDirection =
  | 'inflow_to_exchange'
  | 'outflow_from_exchange'
  | 'wallet_to_wallet';

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
  /** 0–100 anomaly score; null when provider cannot compute one. */
  anomalyScore: number | null;
  timestamp: string;
  narrative: string;
  source: 'live' | 'unavailable';
}

export interface WhaleMovementsResult {
  assetTicker: string;
  status: 'LIVE' | 'AWAITING_LIVE_DATA';
  totalMovements: number | null;
  /** Count of confirmed severe exchange inflows (bearish signal). */
  severeInflowsToExchanges: number | null;
  largestMovementUsd: number | null;
  /** Positive = net inflow to exchanges (bearish); negative = net outflow (bullish). */
  netExchangeFlowUsd: number | null;
  generatedAt: string;
  movements: WhaleMovement[];
  providerNote: string;
}
