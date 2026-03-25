/**
 * Portfolio Allocation & Exposure Management — server-only orchestration.
 *
 * This file imports Telegram + DB-backed subscriber lookup, so it must never be imported by Client Components.
 */

import 'server-only';

import { sendTelegramMessage } from '@/lib/telegram';
import {
  computePortfolioAllocation,
  type PortfolioAllocationInput,
  type PortfolioAllocationResult,
  type PortfolioPosition,
  type AllocationSlice,
  type AssetCategory,
  categorizeSymbol,
  deriveRiskLevel,
} from '@/lib/portfolio-math';

export {
  computePortfolioAllocation,
  categorizeSymbol,
  deriveRiskLevel,
  type PortfolioAllocationInput,
  type PortfolioAllocationResult,
  type PortfolioPosition,
  type AllocationSlice,
  type AssetCategory,
};

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
