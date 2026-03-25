/**
 * Tri-tier scalp parameters for 1–2h horizon (advisory / execution metadata).
 */

export type ScalpRiskTier = 'CAUTIOUS' | 'MODERATE' | 'DANGEROUS';

export interface ScalpExecutionPlan {
  tier: ScalpRiskTier;
  symbol: string;
  /** Suggested hold window in minutes. */
  holdTimeMinutes: { min: number; max: number };
  /** Full take-profit % from entry (positive). */
  targetProfitPct: number;
  /** Stop-loss % from entry (negative). */
  stopLossPct: number;
  /** Normalized 0–100 confidence surfaced to UI / Telegram. */
  aiConfidenceScore: number;
}

const TIER_PARAMS: Record<
  ScalpRiskTier,
  { holdMin: number; holdMax: number; tp: number; sl: number; confFloor: number }
> = {
  CAUTIOUS: { holdMin: 90, holdMax: 120, tp: 0.8, sl: -0.45, confFloor: 72 },
  MODERATE: { holdMin: 60, holdMax: 90, tp: 1.2, sl: -0.65, confFloor: 65 },
  DANGEROUS: { holdMin: 45, holdMax: 75, tp: 1.8, sl: -0.95, confFloor: 58 },
};

/**
 * Build a scalp plan from tier + model confidence (0–100).
 * Confidence is echoed and lightly scaled per tier aggressiveness.
 */
export function buildScalpExecutionPlan(
  symbol: string,
  tier: ScalpRiskTier,
  aiConfidenceScore: number
): ScalpExecutionPlan {
  const p = TIER_PARAMS[tier];
  const c = Math.max(0, Math.min(100, aiConfidenceScore));
  const tierBoost = tier === 'DANGEROUS' ? 1.04 : tier === 'CAUTIOUS' ? 0.96 : 1;
  const adjusted = Math.round(Math.min(100, Math.max(p.confFloor, c * tierBoost)) * 10) / 10;
  return {
    tier,
    symbol: symbol.toUpperCase(),
    holdTimeMinutes: { min: p.holdMin, max: p.holdMax },
    targetProfitPct: p.tp,
    stopLossPct: p.sl,
    aiConfidenceScore: adjusted,
  };
}

export function inferScalpTierFromVolatility(volatilityPct: number): ScalpRiskTier {
  if (!Number.isFinite(volatilityPct) || volatilityPct < 2.5) return 'CAUTIOUS';
  if (volatilityPct > 5.5) return 'DANGEROUS';
  return 'MODERATE';
}
