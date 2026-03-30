import type { VirtualPortfolioRow } from '@/lib/db/virtual-portfolio';

export type RecursiveOptimizerDecision = {
  confidenceThrottlePct: number;
  riskTighteningPct: number;
  note: string;
};

/**
 * All 7 board experts — the canonical authoritative definition for learning/decay logic.
 * Consensus-engine imports this type rather than maintaining a separate copy.
 * Expert 7 (contrarian) is a full weighted contributor, not merely a veto mechanism.
 */
export type BoardExpertKey = 'technician' | 'risk' | 'psych' | 'macro' | 'onchain' | 'deepMemory' | 'contrarian';

/**
 * 7-day rolling hit-rate decay constants.
 * If an expert's 7d hit rate falls below the threshold, its weight is attenuated by the decay factor.
 */
const EXPERT_7D_DECAY_THRESHOLD_PCT = 55;
export const EXPERT_7D_DECAY_FACTOR = 0.85;

/**
 * Computes per-expert 7-day rolling decay multipliers from DB-sourced hit rates.
 * Returns 1 (no decay) when an expert is above threshold, EXPERT_7D_DECAY_FACTOR otherwise.
 * Centralizes the decay math here; consensus-engine only consumes the pre-calculated factors.
 */
export function computeExpert7dDecayFactors(
  hitRates7d: Partial<Record<BoardExpertKey, number>>
): Record<BoardExpertKey, number> {
  const keys: BoardExpertKey[] = ['technician', 'risk', 'psych', 'macro', 'onchain', 'deepMemory', 'contrarian'];
  const result = {} as Record<BoardExpertKey, number>;
  for (const k of keys) {
    result[k] = (hitRates7d[k] ?? 50) < EXPERT_7D_DECAY_THRESHOLD_PCT ? EXPERT_7D_DECAY_FACTOR : 1;
  }
  return result;
}

/**
 * Lightweight post-mortem optimizer.
 * Produces bounded adjustments that other services can consume.
 */
export function computeRecursiveOptimization(input: {
  trade: Pick<VirtualPortfolioRow, 'symbol' | 'entry_price' | 'amount_usd'>;
  pnlPct: number;
  closeReason: string;
}): RecursiveOptimizerDecision {
  const pnl = Number.isFinite(input.pnlPct) ? input.pnlPct : 0;
  const reason = (input.closeReason || '').toLowerCase();

  const liquidationPenalty = reason.includes('liquidation') ? 0.22 : 0;
  const stopPenalty = reason.includes('stop') ? 0.12 : 0;
  const drawdownPenalty = pnl < 0 ? Math.min(0.25, Math.abs(pnl) / 120) : 0;
  const confidenceThrottlePct = Math.round(Math.max(0, liquidationPenalty + stopPenalty + drawdownPenalty) * 1000) / 10;

  const winCredit = pnl > 0 ? Math.min(0.08, pnl / 250) : 0;
  const riskTighteningPct = Math.round(Math.max(0, liquidationPenalty + stopPenalty - winCredit) * 1000) / 10;

  return {
    confidenceThrottlePct,
    riskTighteningPct,
    note:
      confidenceThrottlePct > 0
        ? `Optimizer tighten: ${confidenceThrottlePct}% throttle, ${riskTighteningPct}% risk clamp`
        : 'Optimizer neutral',
  };
}
