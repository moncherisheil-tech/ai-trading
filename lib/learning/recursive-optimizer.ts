import type { VirtualPortfolioRow } from '@/lib/db/virtual-portfolio';
import { prisma } from '@/lib/prisma';

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
 * Ensures the SystemNeuroPlasticity singleton (id=1) exists in the database.
 * Safe to call multiple times (upsert — does not overwrite existing weights).
 * Also seeds 3 synthetic EpisodicMemory records (one per major symbol) if none
 * exist in the last 24 hours, so the Learning Center is never empty on first boot.
 *
 * Call this from /api/ops/init-db and /api/cron/morning-report.
 */
export async function ensureNeuroPlasticityInitialized(): Promise<{
  created: boolean;
  syntheticMemoriesAdded: number;
}> {
  let created = false;
  let syntheticMemoriesAdded = 0;

  try {
    const existing = await prisma.systemNeuroPlasticity.findUnique({ where: { id: 1 } });
    if (!existing) {
      await prisma.systemNeuroPlasticity.create({
        data: {
          id: 1,
          techWeight: 1.0,
          riskWeight: 1.0,
          psychWeight: 1.0,
          macroWeight: 1.0,
          onchainWeight: 1.0,
          deepMemoryWeight: 1.0,
          contrarianWeight: 1.0,
          ceoConfidenceThreshold: 75.0,
          ceoRiskTolerance: 1.0,
          robotSlBufferPct: 2.0,
          robotTpAggressiveness: 1.0,
        },
      });
      created = true;
      console.log('[NeuroPlasticity] Singleton (id=1) created with default weights.');
    }
  } catch (err) {
    console.error('[NeuroPlasticity] Failed to ensure singleton:', err instanceof Error ? err.message : err);
  }

  // Seed synthetic post-mortems if the EpisodicMemory table has no recent entries.
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.episodicMemory.count({ where: { createdAt: { gte: since24h } } });
    if (recentCount === 0) {
      const syntheticSeeds = [
        {
          symbol: 'BTCUSDT',
          marketRegime: 'Bull',
          abstractLesson: 'Synthetic seed (boot): In March 2026 bull conditions, on-chain accumulation overrides exhaustion signals. Prioritise on-chain Expert weight until live post-mortems accumulate.',
        },
        {
          symbol: 'ETHUSDT',
          marketRegime: 'Bull',
          abstractLesson: 'Synthetic seed (boot): ETH tends to lag BTC by 12-24h during initial breakouts. Momentum Scout confirmation at vol-spike ratio > 1.5 significantly improves win rate.',
        },
        {
          symbol: 'SOLUSDT',
          marketRegime: 'Neutral',
          abstractLesson: 'Synthetic seed (boot): SOL is hyper-correlated to BTC risk-on rotation. Contrarian Expert veto is most valuable when RSI > 75 and whale outflows > $50M/24h.',
        },
      ];
      for (const seed of syntheticSeeds) {
        await prisma.episodicMemory.create({ data: seed });
        syntheticMemoriesAdded++;
      }
      console.log(`[NeuroPlasticity] Seeded ${syntheticMemoriesAdded} synthetic EpisodicMemory records.`);
    }
  } catch (err) {
    console.error('[NeuroPlasticity] Failed to seed EpisodicMemory:', err instanceof Error ? err.message : err);
  }

  return { created, syntheticMemoriesAdded };
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
