import type { VirtualPortfolioRow } from '@/lib/db/virtual-portfolio';
import { prisma } from '@/lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// OMEGA SENTINEL PHASE 4: Causal Analysis Types
// ─────────────────────────────────────────────────────────────────────────────

export type CausalFactor =
  | 'MISSED_D1_RESISTANCE'
  | 'MISSED_NEWS_EVENT'
  | 'MTF_DIVERGENCE'
  | 'WHALE_ENTRY_DRIVER'
  | 'NEWS_MOMENTUM_DRIVER'
  | 'TREND_ALIGNED_WIN'
  | 'RISK_OVERSIZED'
  | 'STOP_TOO_TIGHT'
  | 'MANIPULATION_TRAP'
  | 'MACRO_HEADWIND'
  | 'UNKNOWN';

export interface CausalPostMortemResult {
  tradeId: string | number;
  symbol: string;
  outcome: 'WIN' | 'LOSS';
  pnlPct: number;
  primaryCauses: CausalFactor[];
  causalNarrative: string;
  expertWeightAdjustments: Partial<Record<string, number>>;
  /** If true, a 24-hour weight penalty was recorded for a specific expert */
  penaltyApplied: boolean;
  penaltyDetails: string;
  writtenToDb: boolean;
}

export type RecursiveOptimizerDecision = {
  confidenceThrottlePct: number;
  riskTighteningPct: number;
  note: string;
};

/**
 * All 8 board experts — the canonical authoritative definition for learning/decay logic.
 * Consensus-engine imports this type rather than maintaining a separate copy.
 * Expert 7 (contrarian) is a full weighted contributor, not merely a veto mechanism.
 * Expert 8 (newsSentinel) added in Omega Sentinel Phase 3.
 */
export type BoardExpertKey = 'technician' | 'risk' | 'psych' | 'macro' | 'onchain' | 'deepMemory' | 'contrarian' | 'newsSentinel';

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
  const keys: BoardExpertKey[] = [
    'technician', 'risk', 'psych', 'macro', 'onchain', 'deepMemory', 'contrarian', 'newsSentinel',
  ];
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
      // Cast to any: newsSentinelWeight is added via the Omega Sentinel migration
      // (20260405_omega_sentinel_v1). Until `prisma generate` is re-run after the
      // migration, the generated client type won't include this field — the cast
      // is safe because the column exists in the DB after migration runs.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.systemNeuroPlasticity.create as any)({
        data: {
          id: 1,
          techWeight: 1.0,
          riskWeight: 1.0,
          psychWeight: 1.0,
          macroWeight: 1.0,
          onchainWeight: 1.0,
          deepMemoryWeight: 1.0,
          contrarianWeight: 1.0,
          newsSentinelWeight: 1.0,
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

// ─────────────────────────────────────────────────────────────────────────────
// OMEGA SENTINEL PHASE 4: Reflexive Learning & Causal Analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Heuristic causal inference from close reason + PnL + trade context.
 * Returns the most likely CausalFactors without an LLM call (fast path).
 * Exported so consensus-engine can surface causal context before generating a new signal.
 */
export function inferCausalFactors(
  pnlPct: number,
  closeReason: string,
  agentVerdict?: string,
): CausalFactor[] {
  const r = closeReason.toLowerCase();
  const av = (agentVerdict ?? '').toLowerCase();
  const factors: CausalFactor[] = [];

  if (pnlPct < 0) {
    if (r.includes('stop')) factors.push('STOP_TOO_TIGHT');
    if (r.includes('resistance') || av.includes('resistance')) factors.push('MISSED_D1_RESISTANCE');
    if (av.includes('news') || av.includes('regulation') || av.includes('sec')) factors.push('MISSED_NEWS_EVENT');
    if (av.includes('manipulation') || av.includes('trap') || av.includes('fake')) factors.push('MANIPULATION_TRAP');
    if (r.includes('macro') || av.includes('cpi') || av.includes('fed')) factors.push('MACRO_HEADWIND');
    if (av.includes('divergen') || av.includes('timeframe') || av.includes('mtf')) factors.push('MTF_DIVERGENCE');
    if (r.includes('liquidation') || r.includes('risk')) factors.push('RISK_OVERSIZED');
  } else {
    if (av.includes('whale') || av.includes('onchain')) factors.push('WHALE_ENTRY_DRIVER');
    if (av.includes('news') || av.includes('catalyst')) factors.push('NEWS_MOMENTUM_DRIVER');
    if (av.includes('trend') || av.includes('confluent') || av.includes('aligned')) factors.push('TREND_ALIGNED_WIN');
  }

  return factors.length > 0 ? factors : ['UNKNOWN'];
}

/**
 * Maps causal factors to the expert whose weight should be penalised / rewarded.
 * Returns a fractional multiplier delta (negative = penalise, positive = reward).
 */
function causalFactorToWeightAdjustment(
  factors: CausalFactor[],
  outcome: 'WIN' | 'LOSS',
): Partial<Record<string, number>> {
  const adj: Partial<Record<string, number>> = {};
  const loss = outcome === 'LOSS';

  for (const f of factors) {
    switch (f) {
      case 'MISSED_D1_RESISTANCE':
        adj['techWeight'] = loss ? -0.15 : 0.05;
        break;
      case 'MISSED_NEWS_EVENT':
        adj['newsSentinelWeight'] = loss ? -0.20 : 0.10;
        break;
      case 'MTF_DIVERGENCE':
        adj['techWeight'] = loss ? -0.12 : 0.05;
        adj['macroWeight'] = loss ? -0.10 : 0.05;
        break;
      case 'WHALE_ENTRY_DRIVER':
        adj['onchainWeight'] = loss ? -0.05 : 0.15;
        break;
      case 'NEWS_MOMENTUM_DRIVER':
        adj['newsSentinelWeight'] = loss ? -0.05 : 0.15;
        break;
      case 'TREND_ALIGNED_WIN':
        adj['techWeight'] = 0.10;
        adj['macroWeight'] = 0.08;
        break;
      case 'MANIPULATION_TRAP':
        adj['contrarianWeight'] = loss ? -0.18 : 0.12;
        break;
      case 'MACRO_HEADWIND':
        adj['macroWeight'] = loss ? -0.15 : 0.08;
        adj['newsSentinelWeight'] = loss ? -0.12 : 0.06;
        break;
      case 'RISK_OVERSIZED':
        adj['riskWeight'] = loss ? -0.20 : 0;
        break;
      case 'STOP_TOO_TIGHT':
        adj['riskWeight'] = loss ? -0.12 : 0;
        break;
      default:
        break;
    }
  }

  return adj;
}

function buildCausalNarrative(
  factors: CausalFactor[],
  outcome: 'WIN' | 'LOSS',
  symbol: string,
  pnlPct: number,
): string {
  const sign = pnlPct >= 0 ? '+' : '';
  const outcomeLabel = outcome === 'WIN' ? '✅ WIN' : '❌ LOSS';
  const factorLabels: Record<CausalFactor, string> = {
    MISSED_D1_RESISTANCE: 'missed Daily resistance level',
    MISSED_NEWS_EVENT: 'overlooked a news event/catalyst',
    MTF_DIVERGENCE: 'multi-timeframe trend divergence ignored',
    WHALE_ENTRY_DRIVER: 'on-chain whale accumulation was the key driver',
    NEWS_MOMENTUM_DRIVER: 'news momentum catalysed the move',
    TREND_ALIGNED_WIN: 'all timeframes aligned — clean trend trade',
    RISK_OVERSIZED: 'position was oversized relative to volatility',
    STOP_TOO_TIGHT: 'stop-loss was too tight and clipped by normal volatility',
    MANIPULATION_TRAP: 'Contrarian expert missed whale manipulation pattern',
    MACRO_HEADWIND: 'macro/regulatory headwind suppressed the move',
    UNKNOWN: 'cause undetermined — manual review recommended',
  };

  const cause = factors.map((f) => factorLabels[f]).join('; ');
  return `${outcomeLabel} ${symbol} (${sign}${pnlPct.toFixed(2)}%): ${cause}.`;
}

/**
 * Applies causal weight adjustments to the SystemNeuroPlasticity singleton
 * and records the lesson in the LearnedInsight / EpisodicMemory tables.
 *
 * 24-hour NeuroPlasticity penalties are expressed as a negative delta applied
 * to the live weight fields; the SingularityEngine's next post-mortem run will
 * normalise them back into the [MIN_NORMALIZED, MAX_NORMALIZED] bounds.
 */
async function persistCausalAdjustments(
  tradeId: string,
  symbol: string,
  narrative: string,
  adjustments: Partial<Record<string, number>>,
  outcome: 'WIN' | 'LOSS',
): Promise<{ writtenToDb: boolean; penaltyApplied: boolean; penaltyDetails: string }> {
  let writtenToDb = false;
  let penaltyApplied = false;
  let penaltyDetails = '';

  try {
    // 1. Write to LearnedInsight (tradeId → causal narrative)
    // Check if an insight for this trade already exists to avoid duplicates
    const existingInsight = await prisma.learnedInsight.findFirst({
      where: { tradeId },
    });
    if (existingInsight) {
      await prisma.learnedInsight.update({
        where: { id: existingInsight.id },
        data: { failureReason: narrative },
      });
    } else {
      await prisma.learnedInsight.create({
        data: { tradeId, failureReason: narrative, adjustmentApplied: false },
      });
    }

    // 2. Write EpisodicMemory
    const regime = outcome === 'WIN' ? 'CausalWin' : 'CausalLoss';
    await prisma.episodicMemory.create({
      data: { symbol, marketRegime: regime, abstractLesson: narrative },
    });

    writtenToDb = true;
  } catch (err) {
    console.error('[CausalPostMortem] DB write failed (non-fatal):', err instanceof Error ? err.message : err);
  }

  // 3. Apply weight adjustments to SystemNeuroPlasticity singleton
  const WEIGHT_FIELDS: (keyof typeof adjustments)[] = [
    'techWeight', 'riskWeight', 'psychWeight', 'macroWeight',
    'onchainWeight', 'deepMemoryWeight', 'contrarianWeight', 'newsSentinelWeight',
  ];
  const applicableFields = Object.keys(adjustments).filter(
    (k) => WEIGHT_FIELDS.includes(k) && adjustments[k] !== 0
  );

  if (applicableFields.length > 0) {
    try {
      const np = await prisma.systemNeuroPlasticity.findUnique({ where: { id: 1 } });
      if (np) {
        const updateData: Record<string, number> = {};
        const penaltyParts: string[] = [];
        for (const field of applicableFields) {
          const current = (np as unknown as Record<string, number>)[field] ?? 1.0;
          const delta = adjustments[field] ?? 0;
          const newVal = Math.max(0.35, Math.min(2.80, current + delta));
          updateData[field] = newVal;
          if (delta < 0) {
            penaltyParts.push(`${field}: ${current.toFixed(3)} → ${newVal.toFixed(3)} (causal penalty)`);
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.systemNeuroPlasticity.update as any)({ where: { id: 1 }, data: updateData });
        penaltyApplied = penaltyParts.length > 0;
        penaltyDetails = penaltyParts.join(' | ');
        console.log(`[CausalPostMortem] Weight adjustments applied: ${penaltyDetails || 'rewards only'}`);
      }
    } catch (err) {
      console.error('[CausalPostMortem] Weight update failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  return { writtenToDb, penaltyApplied, penaltyDetails };
}

/**
 * MoE Pre-Consensus Feedback Loop.
 *
 * Queries the last N learned_insights for a given symbol before the MoE
 * generates a new consensus signal. The returned context is injected into
 * the LLM prompt so the system learns from past causal failures.
 *
 * @param symbol   e.g. "BTCUSDT"
 * @param limit    Max number of past insights to retrieve (default 5)
 * @returns        A compact string summary suitable for LLM injection
 */
export async function queryLearnedInsightsForSymbol(
  symbol: string,
  limit = 5,
): Promise<string> {
  try {
    // Fetch the most recent EpisodicMemory records for this symbol (causal + synthetic)
    const memories = await prisma.episodicMemory.findMany({
      where: { symbol: { in: [symbol, 'BTCUSDT'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    if (memories.length === 0) {
      return 'No prior learned insights available for this symbol.';
    }

    const lines = memories.map((m, i) =>
      `[${i + 1}] ${m.marketRegime}: ${m.abstractLesson.slice(0, 200)}`
    );
    return `Learned Insights (last ${memories.length} post-mortems):\n${lines.join('\n')}`;
  } catch (err) {
    console.error('[LearningFeedback] Failed to query learned insights:', err instanceof Error ? err.message : err);
    return 'Learned insights unavailable (DB error).';
  }
}

/**
 * Full Causal Post-Mortem Analysis for a closed trade.
 *
 * Beyond Win/Loss, answers:
 *   - WHY did the trade fail? (D1 resistance, news event, manipulation?)
 *   - WHY did the trade win? (Whale entry, news momentum, trend alignment?)
 *
 * Applies expert weight adjustments to SystemNeuroPlasticity based on causal reasons.
 * Writes the lesson to `learned_insights` + `EpisodicMemory`.
 *
 * @param tradeId      The trade/execution ID (string or number)
 * @param symbol       e.g. "BTCUSDT"
 * @param pnlPct       Net PnL percentage (positive = win, negative = loss)
 * @param closeReason  Close reason string from the execution engine
 * @param agentVerdict Expert breakdown JSON or string from the trade record
 */
export async function runCausalPostMortem(params: {
  tradeId: string | number;
  symbol: string;
  pnlPct: number;
  closeReason: string;
  agentVerdict?: string;
}): Promise<CausalPostMortemResult> {
  const { tradeId, symbol, pnlPct, closeReason, agentVerdict } = params;
  const outcome: 'WIN' | 'LOSS' = pnlPct >= 0 ? 'WIN' : 'LOSS';

  const primaryCauses = inferCausalFactors(pnlPct, closeReason, agentVerdict);
  const expertWeightAdjustments = causalFactorToWeightAdjustment(primaryCauses, outcome);
  const causalNarrative = buildCausalNarrative(primaryCauses, outcome, symbol, pnlPct);

  const tradeIdStr = String(tradeId);
  const { writtenToDb, penaltyApplied, penaltyDetails } = await persistCausalAdjustments(
    tradeIdStr,
    symbol,
    causalNarrative,
    expertWeightAdjustments,
    outcome,
  );

  console.log(`[CausalPostMortem] ${causalNarrative}`);

  return {
    tradeId,
    symbol,
    outcome,
    pnlPct,
    primaryCauses,
    causalNarrative,
    expertWeightAdjustments,
    penaltyApplied,
    penaltyDetails,
    writtenToDb,
  };
}
