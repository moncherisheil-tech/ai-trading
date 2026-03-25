/**
 * Math utilities for PnL, Sharpe ratio, and risk metrics.
 * All calculations use Decimal.js to avoid floating-point errors.
 * Division-by-zero is guarded; Sharpe returns 0 when variance is zero or insufficient data.
 */

import { toDecimal } from '@/lib/decimal';

/** Minimum standard deviation to avoid division-by-zero in Sharpe. */
const MIN_STD = 1e-10;

/**
 * Sharpe Ratio (annualized): E[R] / sqrt(Var(R)) * sqrt(252).
 * R = daily excess return (risk-free = 0).
 * Returns 0 when n < 2, variance is zero, or result is not finite.
 */
export function sharpeFromDailyReturns(dailyReturns: number[]): number {
  const n = dailyReturns.length;
  if (n < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / n;
  const meanD = toDecimal(mean);
  const variance = dailyReturns.reduce((sum, r) => {
    const diff = toDecimal(r).minus(meanD);
    return sum.plus(diff.pow(2));
  }, toDecimal(0)).div(Math.max(1, n - 1));
  const std = variance.sqrt();
  if (!std.isFinite() || std.lt(MIN_STD)) return 0;
  const raw = meanD.div(std).times(Math.sqrt(252)).toNumber();
  return Number.isFinite(raw) ? raw : 0;
}
