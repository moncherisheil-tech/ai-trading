export const MAX_ACCOUNT_RISK_PER_TRADE = 0.02;
export const MAX_OPEN_POSITIONS = 5;

const LOW_CONFIDENCE_FLOOR = 60;
const MIXED_CONFIDENCE_CEILING = 75;
const HIGH_CONFIDENCE_FLOOR = 90;
const STABLE_VOLATILITY_PCT = 2.5;
const HIGH_VOLATILITY_PCT = 6;
const MIN_RISK_REWARD_RATIO = 2;
const MIN_STOP_DISTANCE_PCT = 0.004;
const MAX_STOP_DISTANCE_PCT = 0.03;
const VOLATILITY_STOP_MULTIPLIER = 0.6;

export type TradeDirection = 'LONG' | 'SHORT';

export interface PositionSizingResult {
  riskFraction: number;
  positionSizeUsd: number;
  rejected: boolean;
  reason: string;
}

export interface TradeLevels {
  stopLoss: number;
  takeProfit: number;
  stopDistancePct: number;
  takeProfitDistancePct: number;
  riskRewardRatio: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculatePositionSize(
  accountBalance: number,
  aiConfidenceScore: number,
  marketVolatility: number
): PositionSizingResult {
  if (!Number.isFinite(accountBalance) || accountBalance <= 0) {
    return {
      riskFraction: 0,
      positionSizeUsd: 0,
      rejected: true,
      reason: 'Invalid account balance.',
    };
  }

  const confidence = clamp(aiConfidenceScore, 0, 100);
  const volatility = Math.max(0, marketVolatility);

  if (confidence < LOW_CONFIDENCE_FLOOR) {
    return {
      riskFraction: 0,
      positionSizeUsd: 0,
      rejected: true,
      reason: `Confidence ${confidence.toFixed(1)} below minimum threshold ${LOW_CONFIDENCE_FLOOR}.`,
    };
  }

  if (volatility >= HIGH_VOLATILITY_PCT) {
    return {
      riskFraction: 0.005,
      positionSizeUsd: round(accountBalance * 0.005, 2),
      rejected: false,
      reason: `High volatility (${volatility.toFixed(2)}%) - scaled down to 0.5% risk.`,
    };
  }

  if (confidence <= MIXED_CONFIDENCE_CEILING) {
    return {
      riskFraction: 0.005,
      positionSizeUsd: round(accountBalance * 0.005, 2),
      rejected: false,
      reason: `Mixed confidence (${confidence.toFixed(1)}) - scaled down to 0.5% risk.`,
    };
  }

  if (confidence >= HIGH_CONFIDENCE_FLOOR && volatility <= STABLE_VOLATILITY_PCT) {
    return {
      riskFraction: MAX_ACCOUNT_RISK_PER_TRADE,
      positionSizeUsd: round(accountBalance * MAX_ACCOUNT_RISK_PER_TRADE, 2),
      rejected: false,
      reason: 'High confidence with stable volatility - full 2% risk allocation.',
    };
  }

  const interpolatedRiskFraction = clamp(
    0.005 +
      ((confidence - MIXED_CONFIDENCE_CEILING) / (HIGH_CONFIDENCE_FLOOR - MIXED_CONFIDENCE_CEILING)) * 0.01,
    0.005,
    0.015
  );
  return {
    riskFraction: interpolatedRiskFraction,
    positionSizeUsd: round(accountBalance * interpolatedRiskFraction, 2),
    rejected: false,
    reason: `Adaptive risk sizing from confidence ${confidence.toFixed(1)} and volatility ${volatility.toFixed(2)}%.`,
  };
}

export function calculateTradeLevels(
  entryPrice: number,
  volatility: number,
  direction: TradeDirection
): TradeLevels {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error('Invalid entry price for trade-level calculation.');
  }
  if (!Number.isFinite(volatility) || volatility < 0) {
    throw new Error('Invalid volatility for trade-level calculation.');
  }

  const volAsFraction = volatility / 100;
  const dynamicStopDistance = clamp(
    Math.max(volAsFraction * VOLATILITY_STOP_MULTIPLIER, MIN_STOP_DISTANCE_PCT),
    MIN_STOP_DISTANCE_PCT,
    MAX_STOP_DISTANCE_PCT
  );
  const dynamicTpDistance = dynamicStopDistance * MIN_RISK_REWARD_RATIO;

  const stopLoss =
    direction === 'LONG'
      ? entryPrice * (1 - dynamicStopDistance)
      : entryPrice * (1 + dynamicStopDistance);
  const takeProfit =
    direction === 'LONG'
      ? entryPrice * (1 + dynamicTpDistance)
      : entryPrice * (1 - dynamicTpDistance);

  return {
    stopLoss: round(stopLoss),
    takeProfit: round(takeProfit),
    stopDistancePct: round(dynamicStopDistance * 100, 4),
    takeProfitDistancePct: round(dynamicTpDistance * 100, 4),
    riskRewardRatio: MIN_RISK_REWARD_RATIO,
  };
}

export function assertTradeRiskWithinLimit(params: {
  accountBalance: number;
  positionSizeUsd: number;
  entryPrice: number;
  stopLoss: number;
}): void {
  const { accountBalance, positionSizeUsd, entryPrice, stopLoss } = params;
  if (accountBalance <= 0 || positionSizeUsd <= 0 || entryPrice <= 0 || stopLoss <= 0) {
    throw new Error('Invalid risk inputs for limit validation.');
  }

  const stopDistanceFraction = Math.abs(entryPrice - stopLoss) / entryPrice;
  const absoluteRiskUsd = positionSizeUsd * stopDistanceFraction;
  const allowedRiskUsd = accountBalance * MAX_ACCOUNT_RISK_PER_TRADE;

  if (absoluteRiskUsd > allowedRiskUsd) {
    throw new Error(
      `Risk violation: required risk ${absoluteRiskUsd.toFixed(2)} USD exceeds max per-trade risk ${allowedRiskUsd.toFixed(
        2
      )} USD.`
    );
  }
}

export function assertOpenPositionsLimit(openPositionsCount: number): void {
  if (openPositionsCount >= MAX_OPEN_POSITIONS) {
    throw new Error(
      `Risk violation: open positions ${openPositionsCount}/${MAX_OPEN_POSITIONS}. Trade rejected to prevent over-exposure.`
    );
  }
}

/**
 * Fractional Kelly position size in USD from Overseer confidence and optional realized win rate.
 * Uses half-Kelly capped to MAX_ACCOUNT_RISK_PER_TRADE; blends with confidence as edge proxy.
 */
export function computeKellyPositionUsd(params: {
  accountBalance: number;
  overseerConfidencePct: number;
  /** 0–100; when unknown, defaults to 50. */
  historicalWinRatePct?: number;
  /** Reward:risk of the trade (TP distance / SL distance). */
  rewardRiskRatio?: number;
}): { positionUsd: number; kellyFraction: number; note: string } {
  const balance = Math.max(0, params.accountBalance);
  if (balance <= 0) {
    return { positionUsd: 0, kellyFraction: 0, note: 'Zero balance.' };
  }
  const conf = Math.max(0, Math.min(100, params.overseerConfidencePct));
  const winRate = Math.max(0.05, Math.min(0.95, (params.historicalWinRatePct ?? 50) / 100));
  const b = Math.max(0.5, params.rewardRiskRatio ?? MIN_RISK_REWARD_RATIO);
  const edgeFromConfidence = Math.max(0.05, Math.min(0.92, conf / 100 * 0.92));
  const p = Math.min(0.9, (winRate + edgeFromConfidence) / 2);
  const q = 1 - p;
  const kellyFull = (b * p - q) / b;
  const halfKelly = Math.max(0, kellyFull) * 0.5;
  const capped = Math.min(halfKelly, MAX_ACCOUNT_RISK_PER_TRADE);
  const confidenceDampen = 0.65 + (conf / 100) * 0.35;
  const kellyFraction = Math.max(0.0025, Math.min(MAX_ACCOUNT_RISK_PER_TRADE, capped * confidenceDampen));
  const positionUsd = round(balance * kellyFraction, 2);
  return {
    positionUsd,
    kellyFraction,
    note: `Half-Kelly×confidence p≈${p.toFixed(2)} b=${b.toFixed(2)} cap=${MAX_ACCOUNT_RISK_PER_TRADE}`,
  };
}
