/**
 * Prediction success formula for Hebrew AI reports.
 * Dynamic formula (weights from system_configs via getWeights):
 *   P_success = ((W_vol × VolΔ) + (W_rsi × RSI) + (W_sent × Sent)) / RiskFactor
 * VolΔ = volume delta % (normalized 0–100), RSI = 0–100, Sent = sentiment 0–100.
 * Self-correction: when the Retrospective Engine suggests weight changes, they are applied
 * automatically to system_configs (no manual Save).
 */

import { getWeights } from '@/lib/db/prediction-weights';

/** Compute RSI(14) from closing prices. Returns 0–100. */
export function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const slice = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i]! - slice[i - 1]!;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface FormulaInputs {
  /** 24h volume change as percentage (e.g. +15 → 15). Normalized to 0–100 for formula. */
  volumeDeltaPercent: number;
  /** RSI value 0–100 */
  rsiLevel: number;
  /** Sentiment score; we use -1..1 mapped to 0–100: (x+1)*50 */
  marketSentimentNormalized: number;
  /** Risk factor >= 1 (e.g. 1 = low risk, 1.5 = higher). */
  riskFactor: number;
}

/**
 * Computes P_success from the dynamic formula using weights in system_configs.
 * P_success = ((W_vol × VolΔ) + (W_rsi × RSI) + (W_sent × Sent)) / RiskFactor
 * Returns value in 0–100 range (capped).
 */
export function computePSuccess(inputs: FormulaInputs, weights?: { volume: number; rsi: number; sentiment: number }): number {
  const { volumeDeltaPercent, rsiLevel, marketSentimentNormalized, riskFactor } = inputs;
  const w = weights ?? getWeights();
  const volDelta = Math.max(0, Math.min(100, volumeDeltaPercent + 50));
  const rsi = Math.max(0, Math.min(100, rsiLevel));
  const sent = Math.max(0, Math.min(100, marketSentimentNormalized));
  const safeRisk = Math.max(0.1, Number.isFinite(riskFactor) ? riskFactor : 1);
  const raw = (volDelta * w.volume + rsi * w.rsi + sent * w.sentiment) / safeRisk;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

/**
 * Risk level label in Hebrew for report.
 */
export function getRiskLevelHe(riskFactor: number, riskStatus?: 'normal' | 'extreme_fear' | 'extreme_greed'): string {
  if (riskStatus === 'extreme_fear') return 'סיכון גבוה — פחד קיצוני בשוק';
  if (riskStatus === 'extreme_greed') return 'סיכון גבוה — חמדנות קיצונית בשוק';
  if (riskFactor <= 1.1) return 'סיכון נמוך';
  if (riskFactor <= 1.4) return 'סיכון בינוני';
  return 'סיכון גבוה';
}

/**
 * Generates short Hebrew bottom line and 24h forecast from prediction data.
 */
export function buildHebrewReport(params: {
  direction: 'Bullish' | 'Bearish' | 'Neutral';
  probability: number;
  targetPercentage: number;
  riskLevelHe: string;
  symbol: string;
}): { bottom_line_he: string; forecast_24h_he: string } {
  const { direction, probability, targetPercentage, riskLevelHe, symbol } = params;
  const dirHe = direction === 'Bullish' ? 'עליה' : direction === 'Bearish' ? 'ירידה' : 'יציבות';
  const bottom_line_he = `שורה תחתונה: ${symbol} — צפי ${dirHe} בהסתברות ${probability}%. ${riskLevelHe}.`;
  const forecast_24h_he =
    targetPercentage !== 0
      ? `תחזית ל-24 שעות: תנועה צפויה של ${targetPercentage > 0 ? '+' : ''}${targetPercentage}% במחיר.`
      : 'תחזית ל-24 שעות: תנועה מוגבלת; המחיר צפוי להישאר בטווח צר.';
  return { bottom_line_he, forecast_24h_he };
}
