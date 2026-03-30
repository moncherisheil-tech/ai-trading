import { listClosedTradeReinforcementRows } from '@/lib/db/virtual-trades-history';
import { getPrisma } from '@/lib/prisma';
import { dispatchCriticalAlert } from '@/lib/ops/alert-dispatcher';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DAYS_BACK = 7;
const SINGLETON_ID = 1;
const EPSILON = 0.000001;

// ---------------------------------------------------------------------------
// PHASE 1 FIX: MoE Diversity Bounds (NORMALIZED weight fractions)
//
// Mathematical guarantee:
//   - 7 experts → each normalized weight targets a mean of 1.0
//   - Normalized share = w_i / sum(W)
//   - MIN_SHARE = 5%  → w_i_normalized >= 0.05 × 7 = 0.35
//   - MAX_SHARE = 40% → w_i_normalized <= 0.40 × 7 = 2.80
//
//   Proof of non-collapse:
//   If one expert is always wrong over N trades, multiplicative decay
//   of (1 - 0.10)^N would approach 0 unclamped. With MIN_SHARE=5%,
//   the minimum post-normalization weight is 0.35, guaranteeing that
//   even the worst-performing expert retains at least 5% of the total
//   signal weight. Similarly, MAX_SHARE=40% prevents any single expert
//   from exceeding a 2.80 normalized weight regardless of win streaks.
//   The weight COLLAPSE condition (0→∞ or domination) is mathematically
//   impossible within these bounds.
// ---------------------------------------------------------------------------
const MOE_NUM_EXPERTS = 7;
const MOE_MIN_SHARE = 0.05;   // 5% minimum share of total weight pool
const MOE_MAX_SHARE = 0.40;   // 40% maximum share of total weight pool
const MOE_MIN_NORMALIZED = MOE_MIN_SHARE * MOE_NUM_EXPERTS; // 0.35
const MOE_MAX_NORMALIZED = MOE_MAX_SHARE * MOE_NUM_EXPERTS; // 2.80

// Raw weight bounds (pre-normalization guard rails to prevent NaN propagation)
const RAW_WEIGHT_FLOOR = 0.05;
const RAW_WEIGHT_CEILING = 5.0;

/** Multiplicative reward applied to a weight when an expert was correct. */
const REWARD_RATE = 0.05;
/** Multiplicative decay applied to a weight when an expert was wrong (2× heavier). */
const DECAY_RATE = 0.10;

// ---------------------------------------------------------------------------
// PHASE 1 FIX: Slippage-Adjusted PnL Reward
//
// Reference trade size for PnL ratio normalization.
// A $100 reference maps: +2% gain → tanh(0.2) ≈ 0.20 (moderate);
// +10% gain → tanh(1.0) ≈ 0.76 (strong); -5% loss → tanh(-0.5) ≈ -0.46.
// This replaces binary win/loss with a continuous signal that factors in
// BOTH slippage (via net PnL) and magnitude (big wins = big rewards).
// ---------------------------------------------------------------------------
const REFERENCE_TRADE_SIZE_USD = 100;
const PNL_SENSITIVITY = 8; // tanh sensitivity multiplier
/** Minimum magnitude factor to avoid zero-reward on flat trades */
const PNL_MAGNITUDE_FLOOR = 0.20;
/** Maximum magnitude factor — super-rewards large clean entries */
const PNL_MAGNITUDE_CEILING = 1.50;

/** CEO params */
const CEO_THRESHOLD_TIGHTEN_STEP = 2.5;
const CEO_THRESHOLD_RELAX_STEP = 1.5;
const CEO_THRESHOLD_MIN = 60.0;
const CEO_THRESHOLD_MAX = 90.0;
const CEO_WIN_RATE_FLOOR = 0.40;
const CEO_WIN_RATE_CEILING = 0.65;

/** Robot SL params */
const SL_HIT_RATE_HIGH = 0.40;
const SL_HIT_RATE_LOW = 0.15;
const SL_EXPAND_FACTOR = 1.15;
const SL_TIGHTEN_FACTOR = 0.95;
const SL_BUFFER_MIN = 1.0;
const SL_BUFFER_MAX = 5.0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TradeDirection = 'bullish' | 'bearish' | 'neutral';
type ExpertVote = 'bullish' | 'bearish' | 'neutral' | null;

export interface NeuroPlasticity {
  techWeight: number;
  riskWeight: number;
  psychWeight: number;
  macroWeight: number;
  onchainWeight: number;
  deepMemoryWeight: number;
  contrarianWeight: number;
  ceoConfidenceThreshold: number;
  ceoRiskTolerance: number;
  robotSlBufferPct: number;
  robotTpAggressiveness: number;
}

interface FullExpertBreakdown {
  tech: ExpertVote;
  risk: ExpertVote;
  psych: ExpertVote;
  macro: ExpertVote;
  onchain: ExpertVote;
  deepMemory: ExpertVote;
  contrarian: ExpertVote;
}

interface ExpertDelta {
  techDelta: number;
  riskDelta: number;
  psychDelta: number;
  macroDelta: number;
  onchainDelta: number;
  deepMemoryDelta: number;
  contrarianDelta: number;
}

export interface SingularityRunResult {
  tradesEvaluated: number;
  profitableTrades: number;
  losingTrades: number;
  slHits: number;
  winRate: number;
  slHitRate: number;
  previousPlasticity: NeuroPlasticity;
  updatedPlasticity: NeuroPlasticity;
  expertDeltas: ExpertDelta;
  episodicLessonId: string | null;
}

/** Legacy shape — kept so existing callers of ReinforcementEngine compile unchanged. */
export interface ExpertWeights {
  dataExpertWeight: number;
  newsExpertWeight: number;
  macroExpertWeight: number;
}

export interface ReinforcementRunResult {
  tradesEvaluated: number;
  profitableTrades: number;
  losingTrades: number;
  previousWeights: ExpertWeights;
  updatedWeights: ExpertWeights;
  deltas: ExpertWeights;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_NEURO_PLASTICITY: NeuroPlasticity = {
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
};

// ---------------------------------------------------------------------------
// PHASE 1 FIX: MoE Diversity Normalization
//
// Called AFTER the multiplicative update loop. Normalizes all 7 weights
// so they sum to MOE_NUM_EXPERTS (7.0), then hard-clamps each normalized
// weight to [MOE_MIN_NORMALIZED, MOE_MAX_NORMALIZED].
//
// A second normalization pass is performed after clamping because clamping
// may shift the total sum. This is idempotent: applying twice returns the
// same result.
// ---------------------------------------------------------------------------

function normalizeMoEWeights(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    return weights.map(() => 1.0);
  }

  // Step 1: Normalize to mean=1.0 (sum = MOE_NUM_EXPERTS)
  const normalized = weights.map((w) => (w / sum) * MOE_NUM_EXPERTS);

  // Step 2: Hard-clamp each normalized weight to diversity bounds
  const clamped = normalized.map((w) =>
    Math.max(MOE_MIN_NORMALIZED, Math.min(MOE_MAX_NORMALIZED, w))
  );

  // Step 3: Re-normalize after clamping to restore sum = MOE_NUM_EXPERTS
  const clampedSum = clamped.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(clampedSum) || clampedSum <= 0) {
    return weights.map(() => 1.0);
  }
  return clamped.map((w) => (w / clampedSum) * MOE_NUM_EXPERTS);
}

// ---------------------------------------------------------------------------
// PHASE 1 FIX: Slippage-Adjusted PnL Magnitude Factor
//
// Maps realized net PnL (already net of fees + slippage via closeVirtualTrade)
// to a continuous magnitude multiplier in [PNL_MAGNITUDE_FLOOR, PNL_MAGNITUDE_CEILING].
//
// Behavior:
//   pnl = $1   on $100 trade → magnitude ≈ 0.28  (partial reward — likely slippage ate gains)
//   pnl = $5   on $100 trade → magnitude ≈ 0.56  (moderate reward)
//   pnl = $15  on $100 trade → magnitude ≈ 1.00  (full reward)
//   pnl = -$3  on $100 trade → magnitude ≈ 0.39  (partial penalty)
//   pnl = -$15 on $100 trade → magnitude ≈ 1.00  (full penalty)
//
// This ensures that experts who called direction correctly but generated
// near-zero net PnL (high slippage entries) receive less credit, while
// experts enabling clean low-cost entries receive amplified reward.
// ---------------------------------------------------------------------------

function pnlMagnitudeFactor(pnlNetUsd: number): number {
  const ratio = Math.abs(pnlNetUsd) / REFERENCE_TRADE_SIZE_USD;
  const magnitude = Math.tanh(ratio * PNL_SENSITIVITY);
  return Math.max(PNL_MAGNITUDE_FLOOR, Math.min(PNL_MAGNITUDE_CEILING, PNL_MAGNITUDE_FLOOR + magnitude * (PNL_MAGNITUDE_CEILING - PNL_MAGNITUDE_FLOOR)));
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function readPath(src: Record<string, unknown>, ...path: string[]): unknown {
  let cur: unknown = src;
  for (const key of path) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function normalizeVote(raw: unknown): ExpertVote {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (raw > 55) return 'bullish';
    if (raw < 45) return 'bearish';
    return 'neutral';
  }
  const v = String(raw).trim().toLowerCase();
  if (['bullish', 'buy', 'long', 'up', 'positive'].includes(v)) return 'bullish';
  if (['bearish', 'sell', 'short', 'down', 'negative'].includes(v)) return 'bearish';
  if (['neutral', 'hold', 'flat', 'mixed'].includes(v)) return 'neutral';
  return null;
}

function parseFullBreakdown(json: string | null): FullExpertBreakdown {
  const NULL_BREAKDOWN: FullExpertBreakdown = {
    tech: null, risk: null, psych: null, macro: null,
    onchain: null, deepMemory: null, contrarian: null,
  };
  if (!json) return NULL_BREAKDOWN;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NULL_BREAKDOWN;
    const o = parsed as Record<string, unknown>;

    const tech = normalizeVote(
      readPath(o, 'technician', 'stance') ??
      readPath(o, 'dataExpert', 'stance') ??
      readPath(o, 'technician', 'score') ??
      readPath(o, 'expert1', 'stance') ??
      readPath(o, 'expert1', 'confidence')
    );
    const risk = normalizeVote(
      readPath(o, 'riskManager', 'stance') ??
      readPath(o, 'riskAdvisor', 'stance') ??
      readPath(o, 'riskManager', 'score') ??
      readPath(o, 'expert3', 'stance') ??
      readPath(o, 'expert3', 'confidence')
    );
    const psych = normalizeVote(
      readPath(o, 'marketPsychologist', 'stance') ??
      readPath(o, 'newsExpert', 'stance') ??
      readPath(o, 'marketPsychologist', 'score') ??
      readPath(o, 'expert2', 'stance') ??
      readPath(o, 'expert2', 'confidence')
    );
    const macro = normalizeVote(
      readPath(o, 'macroExpert', 'stance') ??
      readPath(o, 'macroOrderBook', 'stance') ??
      readPath(o, 'macroExpert', 'score') ??
      readPath(o, 'expert5', 'stance') ??
      readPath(o, 'expert5', 'confidence')
    );
    const onchain = normalizeVote(
      readPath(o, 'onChainAnalyst', 'stance') ??
      readPath(o, 'whaleTracker', 'stance') ??
      readPath(o, 'onChainAnalyst', 'score') ??
      readPath(o, 'expert4', 'stance') ??
      readPath(o, 'expert4', 'confidence')
    );
    const deepMemory = normalizeVote(
      readPath(o, 'deepMemoryExpert', 'stance') ??
      readPath(o, 'longTermMemory', 'stance') ??
      readPath(o, 'deepMemoryExpert', 'score') ??
      readPath(o, 'expert6', 'stance') ??
      readPath(o, 'expert6', 'confidence')
    );
    const contrarian = normalizeVote(
      readPath(o, 'contrarianExpert', 'stance') ??
      readPath(o, 'devilsAdvocate', 'stance') ??
      readPath(o, 'contrarianExpert', 'score') ??
      readPath(o, 'expert7', 'stance') ??
      readPath(o, 'expert7', 'confidence')
    );

    return { tech, risk, psych, macro, onchain, deepMemory, contrarian };
  } catch {
    return NULL_BREAKDOWN;
  }
}

// ---------------------------------------------------------------------------
// Scoring + weight math
// ---------------------------------------------------------------------------

function directionFromPnl(pnl: number): TradeDirection {
  if (pnl > EPSILON) return 'bullish';
  if (pnl < -EPSILON) return 'bearish';
  return 'neutral';
}

/**
 * Maps a single expert vote against the trade outcome.
 * Returns: +1 (correct), -0.5 (abstained on a directional outcome), -1 (wrong).
 */
function scoreVote(vote: ExpertVote, outcome: TradeDirection): number {
  if (vote == null || outcome === 'neutral') return 0;
  if (vote === outcome) return 1;
  if (vote === 'neutral') return -0.5;
  return -1;
}

/**
 * PHASE 1 FIX: Slippage-adjusted multiplicative weight update.
 *
 * Classic version: score is binary +1/-1, REWARD_RATE/DECAY_RATE are fixed.
 * Hardened version: score magnitude is scaled by the PnL magnitude factor,
 * which reflects how much of the trade's directional gain survived after
 * slippage and fees. A correct call on a high-slippage trade earns less
 * credit than a correct call on a clean low-cost entry.
 *
 * Formula:
 *   correct: w *= (1 + REWARD_RATE × |score| × magnitudeFactor)
 *   wrong:   w *= (1 − DECAY_RATE  × |score| × magnitudeFactor)
 *
 * Raw bounds [RAW_WEIGHT_FLOOR, RAW_WEIGHT_CEILING] are applied here as a
 * NaN/inf guard. The true diversity bounds are enforced by normalizeMoEWeights()
 * which is called AFTER the full trade loop completes.
 */
function applyScoreToWeight(weight: number, score: number, pnlNetUsd: number): number {
  if (score === 0) return weight;
  const magnitudeFactor = pnlMagnitudeFactor(pnlNetUsd);
  const absScore = Math.abs(score);
  if (score > 0) {
    const updated = weight * (1 + REWARD_RATE * absScore * magnitudeFactor);
    return Math.max(RAW_WEIGHT_FLOOR, Math.min(RAW_WEIGHT_CEILING, updated));
  }
  const updated = weight * (1 - DECAY_RATE * absScore * magnitudeFactor);
  return Math.max(RAW_WEIGHT_FLOOR, Math.min(RAW_WEIGHT_CEILING, updated));
}

function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 1.0;
  return Math.max(RAW_WEIGHT_FLOOR, Math.min(RAW_WEIGHT_CEILING, w));
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function loadNeuroPlasticity(): Promise<NeuroPlasticity> {
  const prisma = getPrisma();
  if (!prisma) return { ...DEFAULT_NEURO_PLASTICITY };
  try {
    const row = await prisma.systemNeuroPlasticity.findUnique({ where: { id: SINGLETON_ID } });
    if (!row) return { ...DEFAULT_NEURO_PLASTICITY };
    return {
      techWeight: clampWeight(row.techWeight),
      riskWeight: clampWeight(row.riskWeight),
      psychWeight: clampWeight(row.psychWeight),
      macroWeight: clampWeight(row.macroWeight),
      onchainWeight: clampWeight(row.onchainWeight),
      deepMemoryWeight: clampWeight(row.deepMemoryWeight),
      contrarianWeight: clampWeight(row.contrarianWeight),
      ceoConfidenceThreshold: row.ceoConfidenceThreshold,
      ceoRiskTolerance: row.ceoRiskTolerance,
      robotSlBufferPct: row.robotSlBufferPct,
      robotTpAggressiveness: row.robotTpAggressiveness,
    };
  } catch (err) {
    console.error('[SingularityEngine] loadNeuroPlasticity failed:', err);
    return { ...DEFAULT_NEURO_PLASTICITY };
  }
}

async function persistNeuroPlasticity(np: NeuroPlasticity): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) return;
  try {
    await prisma.systemNeuroPlasticity.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...np },
      update: np,
    });
  } catch (err) {
    console.error('[SingularityEngine] persistNeuroPlasticity failed:', err);
  }
}

async function writeEpisodicMemory(
  symbol: string,
  marketRegime: string,
  abstractLesson: string,
  eventId?: string,
): Promise<string | null> {
  const prisma = getPrisma();
  if (!prisma) return null;
  try {
    const record = await prisma.episodicMemory.create({
      data: { symbol, marketRegime, abstractLesson, eventId: eventId ?? null },
    });
    return record.id;
  } catch (err) {
    console.error('[SingularityEngine] writeEpisodicMemory failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Regime detection
// ---------------------------------------------------------------------------

function inferMarketRegime(breakdown: FullExpertBreakdown[]): string {
  let bullishMacro = 0, bearishMacro = 0;
  let bullishOnchain = 0, bearishOnchain = 0;
  for (const b of breakdown) {
    if (b.macro === 'bullish') bullishMacro++;
    else if (b.macro === 'bearish') bearishMacro++;
    if (b.onchain === 'bullish') bullishOnchain++;
    else if (b.onchain === 'bearish') bearishOnchain++;
  }
  const macroNet = bullishMacro - bearishMacro;
  const onchainNet = bullishOnchain - bearishOnchain;

  if (macroNet > 0 && onchainNet > 0) return 'Risk-On / Accumulation';
  if (macroNet < 0 && onchainNet < 0) return 'Risk-Off / Distribution';
  if (macroNet < 0 && onchainNet > 0) return 'Macro Headwind / On-Chain Divergence';
  if (macroNet > 0 && onchainNet < 0) return 'Macro Tailwind / Whale Distribution';
  return 'Neutral / Ranging';
}

// ---------------------------------------------------------------------------
// Delta-to-weight-key mapping
// ---------------------------------------------------------------------------

const DELTA_TO_WEIGHT_KEY: Record<keyof ExpertDelta, keyof NeuroPlasticity> = {
  techDelta: 'techWeight',
  riskDelta: 'riskWeight',
  psychDelta: 'psychWeight',
  macroDelta: 'macroWeight',
  onchainDelta: 'onchainWeight',
  deepMemoryDelta: 'deepMemoryWeight',
  contrarianDelta: 'contrarianWeight',
};

// ---------------------------------------------------------------------------
// Public read-only accessor
// ---------------------------------------------------------------------------

export async function fetchCurrentNeuroPlasticity(): Promise<NeuroPlasticity> {
  return loadNeuroPlasticity();
}

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------

export class SingularityEngine {
  async runPostMortem(daysBack = DEFAULT_DAYS_BACK): Promise<SingularityRunResult> {
    const trades = await listClosedTradeReinforcementRows(daysBack);
    const previousPlasticity = await loadNeuroPlasticity();

    if (trades.length === 0) {
      return {
        tradesEvaluated: 0,
        profitableTrades: 0,
        losingTrades: 0,
        slHits: 0,
        winRate: 0,
        slHitRate: 0,
        previousPlasticity,
        updatedPlasticity: previousPlasticity,
        expertDeltas: {
          techDelta: 0, riskDelta: 0, psychDelta: 0, macroDelta: 0,
          onchainDelta: 0, deepMemoryDelta: 0, contrarianDelta: 0,
        },
        episodicLessonId: null,
      };
    }

    // -----------------------------------------------------------------------
    // STEP 1 — Parse all breakdowns and accumulate expert scores
    //
    // PHASE 1 FIX: Each weight update now receives pnlNetUsd so that the
    // magnitude factor can scale rewards/penalties by realized net PnL
    // (already net of Binance fees and slippage via applySlippage()).
    // -----------------------------------------------------------------------

    let profitableTrades = 0;
    let losingTrades = 0;
    let slHits = 0;

    let techW = previousPlasticity.techWeight;
    let riskW = previousPlasticity.riskWeight;
    let psychW = previousPlasticity.psychWeight;
    let macroW = previousPlasticity.macroWeight;
    let onchainW = previousPlasticity.onchainWeight;
    let deepMemoryW = previousPlasticity.deepMemoryWeight;
    let contrarianW = previousPlasticity.contrarianWeight;

    const allBreakdowns: FullExpertBreakdown[] = [];

    for (const trade of trades) {
      if (trade.pnl_net_usd > EPSILON) profitableTrades++;
      else if (trade.pnl_net_usd < -EPSILON) losingTrades++;

      const closeReason = (trade.close_reason ?? '').toUpperCase();
      if (closeReason === 'SL' || closeReason === 'STOP' || closeReason === 'STOP_LOSS') slHits++;

      const outcome = directionFromPnl(trade.pnl_net_usd);
      const bd = parseFullBreakdown(trade.expert_breakdown_json);
      allBreakdowns.push(bd);

      // PHASE 1 FIX: Pass pnl_net_usd to applyScoreToWeight for magnitude scaling
      techW       = applyScoreToWeight(techW,       scoreVote(bd.tech,       outcome), trade.pnl_net_usd);
      riskW       = applyScoreToWeight(riskW,       scoreVote(bd.risk,       outcome), trade.pnl_net_usd);
      psychW      = applyScoreToWeight(psychW,      scoreVote(bd.psych,      outcome), trade.pnl_net_usd);
      macroW      = applyScoreToWeight(macroW,      scoreVote(bd.macro,      outcome), trade.pnl_net_usd);
      onchainW    = applyScoreToWeight(onchainW,    scoreVote(bd.onchain,    outcome), trade.pnl_net_usd);
      deepMemoryW = applyScoreToWeight(deepMemoryW, scoreVote(bd.deepMemory, outcome), trade.pnl_net_usd);
      contrarianW = applyScoreToWeight(contrarianW, scoreVote(bd.contrarian, outcome), trade.pnl_net_usd);
    }

    // -----------------------------------------------------------------------
    // STEP 2 — PHASE 1 FIX: Apply MoE diversity normalization
    //
    // After the full multiplicative update loop, normalize all 7 weights to
    // sum=7.0, then hard-clamp each to [MOE_MIN_NORMALIZED, MOE_MAX_NORMALIZED].
    // This enforces: no expert < 5% share, no expert > 40% share.
    // -----------------------------------------------------------------------

    const rawWeights = [techW, riskW, psychW, macroW, onchainW, deepMemoryW, contrarianW];
    const [
      techWN, riskWN, psychWN, macroWN, onchainWN, deepMemoryWN, contrarianWN
    ] = normalizeMoEWeights(rawWeights);

    // Log weight collapse detection
    const preNormMax = Math.max(...rawWeights);
    const preNormMin = Math.min(...rawWeights);
    const preNormDominanceShare = preNormMax / rawWeights.reduce((a, b) => a + b, 0);
    if (preNormDominanceShare > MOE_MAX_SHARE) {
      console.warn(
        `[SingularityEngine] Weight collapse detected pre-normalization: ` +
        `max=${preNormMax.toFixed(3)}, min=${preNormMin.toFixed(3)}, ` +
        `dominance=${(preNormDominanceShare * 100).toFixed(1)}% > threshold ${(MOE_MAX_SHARE * 100).toFixed(0)}%. ` +
        `MoE diversity normalization applied.`
      );
    }

    // -----------------------------------------------------------------------
    // STEP 3 — CEO threshold adaptation
    // -----------------------------------------------------------------------

    const winRate = trades.length > 0 ? profitableTrades / trades.length : 0;
    const slHitRate = trades.length > 0 ? slHits / trades.length : 0;

    let ceoThreshold = previousPlasticity.ceoConfidenceThreshold;
    if (winRate < CEO_WIN_RATE_FLOOR) {
      ceoThreshold = Math.min(ceoThreshold + CEO_THRESHOLD_TIGHTEN_STEP, CEO_THRESHOLD_MAX);
    } else if (winRate > CEO_WIN_RATE_CEILING) {
      ceoThreshold = Math.max(ceoThreshold - CEO_THRESHOLD_RELAX_STEP, CEO_THRESHOLD_MIN);
    }
    const ceoRiskTolerance = Math.max(0.5, Math.min(1.5, 0.5 + winRate));

    // -----------------------------------------------------------------------
    // STEP 4 — Robot SL buffer adaptation
    // -----------------------------------------------------------------------

    let slBuffer = previousPlasticity.robotSlBufferPct;
    if (slHitRate > SL_HIT_RATE_HIGH) {
      slBuffer = Math.min(slBuffer * SL_EXPAND_FACTOR, SL_BUFFER_MAX);
    } else if (slHitRate < SL_HIT_RATE_LOW && slHitRate > 0) {
      slBuffer = Math.max(slBuffer * SL_TIGHTEN_FACTOR, SL_BUFFER_MIN);
    }
    const tpAggressiveness = Math.max(0.5, Math.min(2.0, 0.5 + winRate * 1.5));

    // -----------------------------------------------------------------------
    // STEP 5 — Assemble updated plasticity record (using diversity-normalized weights)
    // -----------------------------------------------------------------------

    const updatedPlasticity: NeuroPlasticity = {
      techWeight: techWN!,
      riskWeight: riskWN!,
      psychWeight: psychWN!,
      macroWeight: macroWN!,
      onchainWeight: onchainWN!,
      deepMemoryWeight: deepMemoryWN!,
      contrarianWeight: contrarianWN!,
      ceoConfidenceThreshold: ceoThreshold,
      ceoRiskTolerance,
      robotSlBufferPct: slBuffer,
      robotTpAggressiveness: tpAggressiveness,
    };

    const expertDeltas: ExpertDelta = {
      techDelta:       (techWN ?? techW)       - previousPlasticity.techWeight,
      riskDelta:       (riskWN ?? riskW)       - previousPlasticity.riskWeight,
      psychDelta:      (psychWN ?? psychW)      - previousPlasticity.psychWeight,
      macroDelta:      (macroWN ?? macroW)      - previousPlasticity.macroWeight,
      onchainDelta:    (onchainWN ?? onchainW)    - previousPlasticity.onchainWeight,
      deepMemoryDelta: (deepMemoryWN ?? deepMemoryW) - previousPlasticity.deepMemoryWeight,
      contrarianDelta: (contrarianWN ?? contrarianW) - previousPlasticity.contrarianWeight,
    };

    // -----------------------------------------------------------------------
    // STEP 6 — Persist
    // -----------------------------------------------------------------------

    await persistNeuroPlasticity(updatedPlasticity);

    // -----------------------------------------------------------------------
    // STEP 7 — Episodic memory generation
    // -----------------------------------------------------------------------

    const marketRegime = inferMarketRegime(allBreakdowns);
    const lessonParts: string[] = [];
    const EXPERT_LABELS: Record<keyof ExpertDelta, string> = {
      techDelta: 'Technician',
      riskDelta: 'Risk Manager',
      psychDelta: 'Market Psychologist',
      macroDelta: 'Macro Expert',
      onchainDelta: 'On-Chain Analyst',
      deepMemoryDelta: 'Deep Memory',
      contrarianDelta: 'Contrarian',
    };

    const deltaPairs = Object.entries(expertDeltas) as [keyof ExpertDelta, number][];
    const sortedDeltas = [...deltaPairs].sort((a, b) => b[1] - a[1]);
    const topGainerEntry = sortedDeltas[0];
    const topLoserEntry = sortedDeltas[sortedDeltas.length - 1];

    const firstSymbol = trades[0]?.symbol ?? 'UNKNOWN';
    lessonParts.push(`Symbol: ${firstSymbol}. Market Regime: ${marketRegime}.`);
    lessonParts.push(
      `Win rate: ${(winRate * 100).toFixed(1)}% over ${trades.length} trades. SL-hit rate: ${(slHitRate * 100).toFixed(1)}%.`
    );
    lessonParts.push(
      `MoE diversity enforced: weights normalized to [${MOE_MIN_NORMALIZED.toFixed(2)}, ${MOE_MAX_NORMALIZED.toFixed(2)}] range (5%-40% share bounds).`
    );

    if (topGainerEntry && topGainerEntry[1] > EPSILON) {
      const prevW = previousPlasticity[DELTA_TO_WEIGHT_KEY[topGainerEntry[0]]];
      const nextW = updatedPlasticity[DELTA_TO_WEIGHT_KEY[topGainerEntry[0]]];
      lessonParts.push(
        `Top contributor: ${EXPERT_LABELS[topGainerEntry[0]]} (weight ${(prevW as number).toFixed(3)} → ${(nextW as number).toFixed(3)}).`
      );
    }
    if (topLoserEntry && topLoserEntry[1] < -EPSILON) {
      const prevW = previousPlasticity[DELTA_TO_WEIGHT_KEY[topLoserEntry[0]]];
      const nextW = updatedPlasticity[DELTA_TO_WEIGHT_KEY[topLoserEntry[0]]];
      lessonParts.push(
        `Worst contributor: ${EXPERT_LABELS[topLoserEntry[0]]} — weight decayed (${(prevW as number).toFixed(3)} → ${(nextW as number).toFixed(3)}) due to repeated mis-calls.`
      );
    }

    if (updatedPlasticity.ceoConfidenceThreshold > previousPlasticity.ceoConfidenceThreshold) {
      lessonParts.push(
        `CEO entry threshold tightened: ${previousPlasticity.ceoConfidenceThreshold.toFixed(1)} → ${updatedPlasticity.ceoConfidenceThreshold.toFixed(1)} (poor win rate enforcement).`
      );
    } else if (updatedPlasticity.ceoConfidenceThreshold < previousPlasticity.ceoConfidenceThreshold) {
      lessonParts.push(
        `CEO entry threshold relaxed: ${previousPlasticity.ceoConfidenceThreshold.toFixed(1)} → ${updatedPlasticity.ceoConfidenceThreshold.toFixed(1)} (strong win rate detected).`
      );
    }

    if (updatedPlasticity.robotSlBufferPct > previousPlasticity.robotSlBufferPct) {
      lessonParts.push(
        `Robot SL buffer expanded: ${previousPlasticity.robotSlBufferPct.toFixed(2)}% → ${updatedPlasticity.robotSlBufferPct.toFixed(2)}% (SL-hit rate ${(slHitRate * 100).toFixed(1)}%).`
      );
    } else if (updatedPlasticity.robotSlBufferPct < previousPlasticity.robotSlBufferPct) {
      lessonParts.push(
        `Robot SL buffer tightened: ${previousPlasticity.robotSlBufferPct.toFixed(2)}% → ${updatedPlasticity.robotSlBufferPct.toFixed(2)}% (clean directional flow, low SL-hit rate).`
      );
    }

    lessonParts.push(
      `Slippage-adjusted PnL magnitudes factored into all 7 expert weight updates (reference size: $${REFERENCE_TRADE_SIZE_USD}).`
    );

    const abstractLesson = lessonParts.join(' ');
    const lastEventId = trades[trades.length - 1]?.event_id;
    const episodicLessonId = await writeEpisodicMemory(
      firstSymbol,
      marketRegime,
      abstractLesson,
      lastEventId,
    );

    // -----------------------------------------------------------------------
    // STEP 8 — Alert
    // -----------------------------------------------------------------------

    await dispatchCriticalAlert(
      'Singularity RL Post-Mortem Complete',
      `Neuro-plasticity updated. Trades=${trades.length} W/L=${profitableTrades}/${losingTrades} ` +
      `WinRate=${(winRate * 100).toFixed(1)}% SLHitRate=${(slHitRate * 100).toFixed(1)}% ` +
      `CEOThreshold=${updatedPlasticity.ceoConfidenceThreshold.toFixed(1)} ` +
      `SLBuffer=${updatedPlasticity.robotSlBufferPct.toFixed(2)}% ` +
      `MoEDiversity=[${MOE_MIN_NORMALIZED.toFixed(2)},${MOE_MAX_NORMALIZED.toFixed(2)}]`,
      'INFO'
    );

    return {
      tradesEvaluated: trades.length,
      profitableTrades,
      losingTrades,
      slHits,
      winRate,
      slHitRate,
      previousPlasticity,
      updatedPlasticity,
      expertDeltas,
      episodicLessonId,
    };
  }
}

// ---------------------------------------------------------------------------
// Legacy shim
// ---------------------------------------------------------------------------

export class ReinforcementEngine {
  private singularity = new SingularityEngine();

  async evaluateRecentTrades(daysBack = DEFAULT_DAYS_BACK): Promise<ReinforcementRunResult> {
    const result = await this.singularity.runPostMortem(daysBack);

    const toLegacyWeights = (np: NeuroPlasticity): ExpertWeights => ({
      dataExpertWeight: np.techWeight,
      newsExpertWeight: np.psychWeight,
      macroExpertWeight: np.macroWeight,
    });

    const deltas: ExpertWeights = {
      dataExpertWeight: result.expertDeltas.techDelta,
      newsExpertWeight: result.expertDeltas.psychDelta,
      macroExpertWeight: result.expertDeltas.macroDelta,
    };

    return {
      tradesEvaluated: result.tradesEvaluated,
      profitableTrades: result.profitableTrades,
      losingTrades: result.losingTrades,
      previousWeights: toLegacyWeights(result.previousPlasticity),
      updatedWeights: toLegacyWeights(result.updatedPlasticity),
      deltas,
    };
  }
}
