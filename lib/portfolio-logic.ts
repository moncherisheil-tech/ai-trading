/**
 * Portfolio Allocation & Exposure Management — allocation engine for Smart Money terminal.
 * Computes per-asset weights, categories (Majors / Stablecoins / Altcoins), and total exposure.
 * Elite Terminal v1.3: Exposure Sentinel — CEO-style Telegram alert when exposure or concentration exceeds thresholds.
 */

import { round2, toDecimal } from '@/lib/decimal';
import { sendTelegramMessage } from '@/lib/telegram';

/** Asset category for allocation display and risk context. */
export type AssetCategory = 'majors' | 'stablecoins' | 'altcoins';

const MAJORS = new Set(['BTC', 'ETH', 'BTCUSDT', 'ETHUSDT']);
const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'USDTUSDT', 'USDCUSDT']);

/**
 * Categorize a symbol into Majors (BTC, ETH), Stablecoins (USDC, USDT, …), or Altcoins.
 */
export function categorizeSymbol(symbol: string): AssetCategory {
  const base = symbol.replace(/USDT$/i, '').toUpperCase();
  const full = symbol.toUpperCase();
  if (MAJORS.has(base) || MAJORS.has(full)) return 'majors';
  if (STABLECOINS.has(base) || STABLECOINS.has(full)) return 'stablecoins';
  return 'altcoins';
}

/** Single position with current market value (for allocation). */
export type PortfolioPosition = {
  symbol: string;
  /** Current value in USD (cost + unrealized PnL, or amount × currentPrice). */
  currentValueUsd: number;
  /** Amount of asset (for display). */
  amountAsset: number;
  /** Optional cost basis in USD. */
  costUsd?: number;
  /** Unrealized PnL in USD. */
  unrealizedPnlUsd?: number;
};

/** Input for portfolio allocation: liquid cash + positions. */
export type PortfolioAllocationInput = {
  /** Available cash (liquid balance) in USD. */
  liquidBalanceUsd: number;
  /** Open positions with current values. */
  positions: PortfolioPosition[];
};

/** Per-asset allocation slice for charts and legend. */
export type AllocationSlice = {
  symbol: string;
  /** Display label (e.g. "BTC" from "BTCUSDT"). */
  label: string;
  category: AssetCategory;
  /** Current value in USD. */
  currentValueUsd: number;
  /** Weight as percentage of total portfolio (0–100). */
  weightPct: number;
  /** Amount of asset (for legend). */
  amountAsset: number;
};

/** Aggregated allocation result. */
export type PortfolioAllocationResult = {
  /** Total portfolio value (liquid + positions at current value). */
  totalPortfolioValueUsd: number;
  /** Liquid (cash) balance in USD. */
  liquidBalanceUsd: number;
  /** Sum of current value of all positions. */
  positionsValueUsd: number;
  /** Per-asset allocation slices (including "Cash" if liquid > 0). */
  slices: AllocationSlice[];
  /** Total exposure: percentage of portfolio currently in open trades (positions / total). */
  totalExposurePct: number;
  /** Asset concentration: max single-asset weight (excluding cash). High = concentrated. */
  assetConcentrationPct: number;
};

/**
 * Compute portfolio allocation: weights, categories, and exposure.
 *
 * Weight_i = (CurrentValue_i / TotalPortfolioValue) × 100
 * Total Exposure = (positions value / total portfolio value) × 100
 */
export function computePortfolioAllocation(input: PortfolioAllocationInput): PortfolioAllocationResult {
  const liquid = toDecimal(input.liquidBalanceUsd);
  const positionValues = input.positions.map((p) => toDecimal(p.currentValueUsd));
  const positionsTotal = positionValues.reduce((s, v) => s.plus(v), toDecimal(0));
  const totalPortfolio = liquid.plus(positionsTotal);

  const totalPortfolioNum = round2(totalPortfolio);
  const liquidNum = round2(liquid);
  const positionsValueNum = round2(positionsTotal);

  const slices: AllocationSlice[] = [];

  if (liquidNum > 0 && totalPortfolioNum > 0) {
    const cashWeight = liquid.div(totalPortfolio).times(100);
    slices.push({
      symbol: 'CASH',
      label: 'יתרה נזילה',
      category: 'stablecoins',
      currentValueUsd: liquidNum,
      weightPct: round2(cashWeight),
      amountAsset: liquidNum,
    });
  }

  for (const p of input.positions) {
    const value = toDecimal(p.currentValueUsd);
    if (value.lte(0) || totalPortfolio.lte(0)) continue;
    const weightPct = value.div(totalPortfolio).times(100);
    const label = p.symbol.replace(/USDT$/i, '') || p.symbol;
    slices.push({
      symbol: p.symbol,
      label,
      category: categorizeSymbol(p.symbol),
      currentValueUsd: round2(p.currentValueUsd),
      weightPct: round2(weightPct),
      amountAsset: p.amountAsset,
    });
  }

  // Sort by weight descending (excluding cash for concentration)
  slices.sort((a, b) => (b.symbol === 'CASH' ? 1 : b.weightPct - a.weightPct));

  const totalExposurePct =
    totalPortfolioNum > 0 ? round2(positionsTotal.div(totalPortfolio).times(100)) : 0;

  const nonCashWeights = slices.filter((s) => s.symbol !== 'CASH').map((s) => s.weightPct);
  const assetConcentrationPct = nonCashWeights.length > 0 ? Math.max(...nonCashWeights) : 0;

  return {
    totalPortfolioValueUsd: totalPortfolioNum,
    liquidBalanceUsd: liquidNum,
    positionsValueUsd: positionsValueNum,
    slices,
    totalExposurePct,
    assetConcentrationPct,
  };
}

/**
 * Derive a simple risk level (0–100) from exposure and concentration.
 * Used for "Risk Level" progress bar.
 */
export function deriveRiskLevel(exposurePct: number, concentrationPct: number): number {
  // Equal weight: exposure 50%, concentration 50% → moderate risk
  const exposureScore = Math.min(100, exposurePct * 1.2);
  const concentrationScore = Math.min(100, concentrationPct);
  return round2((toDecimal(exposureScore).plus(concentrationScore).div(2).toNumber()));
}

const DEFAULT_EXPOSURE_THRESHOLD_PCT = 70;
const DEFAULT_CONCENTRATION_THRESHOLD_PCT = 20;

export type RiskThresholdResult = {
  triggered: boolean;
  totalExposurePct: number;
  maxConcentrationPct: number;
  liquidReserveUsd: number;
  topAssetLabel: string;
  topAssetPct: number;
  message?: string;
};

export type RiskThresholdOptions = {
  maxExposurePct?: number;
  maxConcentrationPct?: number;
};

/**
 * Exposure Sentinel: trigger CEO-style Telegram alert when exposure or concentration exceed thresholds.
 * Thresholds from Master Command Center when provided; else defaults (70% / 20%).
 */
export async function checkRiskThresholds(
  input: PortfolioAllocationInput,
  options?: RiskThresholdOptions
): Promise<RiskThresholdResult> {
  const allocation = computePortfolioAllocation(input);
  const { totalExposurePct, assetConcentrationPct, liquidBalanceUsd, slices } = allocation;
  const topSlice = slices.filter((s) => s.symbol !== 'CASH')[0];
  const topAssetLabel = topSlice?.label ?? '—';
  const topAssetPct = topSlice?.weightPct ?? 0;

  const exposureLimit = options?.maxExposurePct ?? DEFAULT_EXPOSURE_THRESHOLD_PCT;
  const concentrationLimit = options?.maxConcentrationPct ?? DEFAULT_CONCENTRATION_THRESHOLD_PCT;
  const triggered =
    totalExposurePct > exposureLimit || assetConcentrationPct > concentrationLimit;

  const result: RiskThresholdResult = {
    triggered,
    totalExposurePct,
    maxConcentrationPct: assetConcentrationPct,
    liquidReserveUsd: liquidBalanceUsd,
    topAssetLabel,
    topAssetPct,
  };

  if (!triggered) return result;

  const advice: string[] = [];
  if (totalExposurePct > exposureLimit) {
    advice.push('הפחת חשיפה כללית — סגור חלק מהפוזיציות או הוסף מזומן.');
  }
  if (assetConcentrationPct > concentrationLimit) {
    advice.push(`פיזור נמוך — נכס ${topAssetLabel} מהווה ${topAssetPct.toFixed(1)}% מהתיק. שקול צמצום או גידור.`);
  }

  const message =
    '🔴 <b>LEVEL: CRITICAL EXPOSURE</b>\n\n' +
    `חשיפה כללית: ${totalExposurePct.toFixed(1)}%\n` +
    `נכס דומיננטי: ${topAssetLabel} (${topAssetPct.toFixed(1)}%)\n` +
    `יתרה נזילה: $${liquidBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n` +
    `המלצה: ${advice.join(' ')}`;

  result.message = message;
  await sendTelegramMessage(message, { parse_mode: 'HTML' }).catch(() => {});
  return result;
}
