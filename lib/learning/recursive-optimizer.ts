import type { VirtualPortfolioRow } from '@/lib/db/virtual-portfolio';

export type RecursiveOptimizerDecision = {
  confidenceThrottlePct: number;
  riskTighteningPct: number;
  note: string;
};

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
