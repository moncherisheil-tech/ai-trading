import type { PredictionRecord } from '@/lib/db';

export type BacktestOutcomeLabel =
  | 'bullish_win'
  | 'bearish_win'
  | 'neutral_win'
  | 'direction_miss'
  | 'invalid';

export interface BacktestEvaluationResult {
  isCorrect: boolean;
  priceDiffPct: number;
  absoluteErrorPct: number;
  outcomeLabel: BacktestOutcomeLabel;
}

/**
 * Evaluate a single prediction against the current market price.
 * This function is pure and contains no I/O so it can be reused by
 * workers, UI-triggered evaluations and future learning agents.
 */
export function evaluatePredictionOutcome(
  record: PredictionRecord,
  currentPrice: number,
): BacktestEvaluationResult | null {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return null;
  }

  if (!Number.isFinite(record.entry_price) || record.entry_price <= 0) {
    return null;
  }

  const priceDiffPct = ((currentPrice - record.entry_price) / record.entry_price) * 100;
  const absoluteErrorPct = Math.abs(priceDiffPct);

  let isCorrect = false;
  let outcomeLabel: BacktestOutcomeLabel = 'direction_miss';

  if (record.predicted_direction === 'Bullish') {
    isCorrect = priceDiffPct > 0;
    outcomeLabel = isCorrect ? 'bullish_win' : 'direction_miss';
  } else if (record.predicted_direction === 'Bearish') {
    isCorrect = priceDiffPct < 0;
    outcomeLabel = isCorrect ? 'bearish_win' : 'direction_miss';
  } else if (record.predicted_direction === 'Neutral') {
    isCorrect = Math.abs(priceDiffPct) < 1;
    outcomeLabel = isCorrect ? 'neutral_win' : 'direction_miss';
  } else {
    outcomeLabel = 'invalid';
  }

  return {
    isCorrect,
    priceDiffPct,
    absoluteErrorPct,
    outcomeLabel,
  };
}

