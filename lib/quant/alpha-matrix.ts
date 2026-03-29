/**
 * Quantitative Alpha Matrix Scorer
 *
 * Computes a single normalised AlphaScore [0, 1] from:
 *   - LLM Consensus (weighted aggregate of Groq / Anthropic / Gemini probabilities)
 *   - Normalised ATR (raw volatility %, penalises erratic movers)
 *   - VWAP Deviation (structural price positioning)
 *   - CVD Slope (momentum from signal-core or fallback 0)
 *   - Risk Adjustment Factor (inverse ATR penalty)
 *
 * Tier Classification:
 *   Tier S  — Alpha: high consensus, low volatility, tight SL, R:R ≥ 3
 *   Tier A  — High Yield/High Risk: strong signal but wide ATR, R:R ≥ 2
 *   Tier B  — Solid/Steady: lower volatility, slower setup, R:R ≥ 1.5
 *
 * Dynamic Stop Loss uses the STRICTER of:
 *   1. 2× ATR(14)
 *   2. 1.5× standard deviation of last 20 closes
 */

export type AlphaTier = 'S' | 'A' | 'B' | 'UNRANKED';

export interface TriCoreProbabilities {
  groq: number;       // 0-100 win probability from Groq hourly core
  anthropic: number;  // 0-100 from Anthropic daily whale core
  gemini: number;     // 0-100 from Gemini weekly/long core (average of weekly + long)
}

export interface AlphaMatrixInput {
  symbol: string;
  entryPrice: number;
  direction: 'Long' | 'Short';
  triCore: TriCoreProbabilities;
  /** ATR(14) raw value in price units (same currency as entryPrice). */
  atr14: number | null;
  /** Last 20 close prices for standard-deviation SL calculation. */
  closes20: number[];
  /** VWAP price — if unavailable, pass null (score defaults to 0). */
  vwap: number | null;
  /** CVD slope from signal-core (units/s). If unavailable, pass 0. */
  cvdSlope: number;
  /** RSI(14) at current bar. */
  rsi14: number | null;
  /** True if whale on-chain flow confirms the direction. */
  whaleConfirmed: boolean;
}

export interface AlphaMatrixResult {
  symbol: string;
  alphaScore: number;       // [0, 1] composite score
  tier: AlphaTier;

  // Risk levels
  normalizedAtrPct: number; // ATR / entry × 100
  llmConsensusScore: number; // [0, 100] weighted LLM probability

  // Price levels
  stopLoss: number;
  slMethod: string;
  slDistanceAbs: number;
  tp1: number;
  tp2: number;
  riskReward: number;

  // Supporting metrics
  vwapDeviationPct: number | null;
  cvdSlope: number;
  rsi14: number | null;
  whaleConfirmed: boolean;

  // Sub-scores (for debugging / transparency)
  vwapScore: number;
  cvdScore: number;
  riskAdjustment: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants (env-overridable for quant tuning)
// ────────────────────────────────────────────────────────────────────────────

const W_LLM = 0.50;
const W_VWAP = 0.20;
const W_CVD = 0.15;
const W_RISK = 0.15;

const LLM_W_GROQ = 0.35;
const LLM_W_ANTHROPIC = 0.40;
const LLM_W_GEMINI = 0.25;

const CVD_NORMALIZATION = 0.005; // empirical: CVD slope of 0.005 = full score

const TIER_S_ALPHA_SCORE = 0.72;
const TIER_S_MAX_ATR_PCT = 3.0;
const TIER_S_MIN_RR = 3.0;

const TIER_A_ALPHA_SCORE = 0.58;
const TIER_A_MIN_ATR_PCT = 2.5;
const TIER_A_MIN_RR = 2.0;

const TIER_B_ALPHA_SCORE = 0.48;
const TIER_B_MAX_ATR_PCT = 2.5;
const TIER_B_MIN_RR = 1.5;

// Minimum risk distance as % of entry (floor to avoid zero-SL issues)
const SL_FLOOR_PCT = 0.005; // 0.5%
const ATR_SL_MULTIPLIER = 2.0;
const STDDEV_SL_MULTIPLIER = 1.5;
const MIN_RR = 2.0; // TP1 target R:R

// ────────────────────────────────────────────────────────────────────────────
// Pure math helpers
// ────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ────────────────────────────────────────────────────────────────────────────
// Dynamic Stop Loss
// ────────────────────────────────────────────────────────────────────────────

function computeStopLoss(
  entry: number,
  direction: 'Long' | 'Short',
  atr14: number | null,
  closes20: number[]
): { stopLoss: number; slDistanceAbs: number; slMethod: string } {
  const floor = entry * SL_FLOOR_PCT;

  const atrDistance = atr14 != null && atr14 > 0 ? atr14 * ATR_SL_MULTIPLIER : 0;

  const sd = stddev(closes20.slice(-20));
  const sdDistance = sd > 0 ? sd * STDDEV_SL_MULTIPLIER : 0;

  // Strictest (largest) distance wins → tightest SL for S-tier, widest for A-tier
  const distance = Math.max(atrDistance, sdDistance, floor);

  let slMethod: string;
  if (distance === atrDistance && atrDistance > 0) {
    slMethod = `${ATR_SL_MULTIPLIER}×ATR(14)`;
  } else if (distance === sdDistance && sdDistance > 0) {
    slMethod = `${STDDEV_SL_MULTIPLIER}×StdDev(20)`;
  } else {
    slMethod = 'Floor(0.5%)';
  }

  const stopLoss = direction === 'Long' ? entry - distance : entry + distance;
  return { stopLoss, slDistanceAbs: distance, slMethod };
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-score calculators
// ────────────────────────────────────────────────────────────────────────────

function scoreLLMConsensus(tc: TriCoreProbabilities): number {
  return (
    (tc.groq * LLM_W_GROQ + tc.anthropic * LLM_W_ANTHROPIC + tc.gemini * LLM_W_GEMINI) / 100
  );
}

function scoreVWAP(entry: number, vwap: number | null): { score: number; deviationPct: number | null } {
  if (vwap == null || vwap <= 0) return { score: 0, deviationPct: null };
  const deviationPct = ((entry - vwap) / vwap) * 100;
  // Reward closeness to VWAP (within ±5% = 0→1 scale)
  const score = clamp(1 - Math.abs(deviationPct) / 5, 0, 1);
  return { score, deviationPct };
}

function scoreCVD(cvdSlope: number): number {
  return clamp(Math.abs(cvdSlope) / CVD_NORMALIZATION, 0, 1);
}

function scoreRiskAdjustment(normalizedAtrPct: number): number {
  return 1 / (1 + normalizedAtrPct / 3);
}

// ────────────────────────────────────────────────────────────────────────────
// Tier classifier
// ────────────────────────────────────────────────────────────────────────────

function classifyTier(alphaScore: number, normalizedAtrPct: number, rr: number): AlphaTier {
  if (
    alphaScore >= TIER_S_ALPHA_SCORE &&
    normalizedAtrPct < TIER_S_MAX_ATR_PCT &&
    rr >= TIER_S_MIN_RR
  ) return 'S';

  if (
    alphaScore >= TIER_A_ALPHA_SCORE &&
    normalizedAtrPct >= TIER_A_MIN_ATR_PCT &&
    rr >= TIER_A_MIN_RR
  ) return 'A';

  if (
    alphaScore >= TIER_B_ALPHA_SCORE &&
    normalizedAtrPct < TIER_B_MAX_ATR_PCT &&
    rr >= TIER_B_MIN_RR
  ) return 'B';

  return 'UNRANKED';
}

// ────────────────────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────────────────────

export function computeAlphaMatrix(input: AlphaMatrixInput): AlphaMatrixResult {
  const {
    symbol, entryPrice, direction, triCore, atr14, closes20,
    vwap, cvdSlope, rsi14, whaleConfirmed,
  } = input;

  // Normalised ATR %
  const normalizedAtrPct =
    atr14 != null && atr14 > 0 ? (atr14 / entryPrice) * 100 : 0;

  // Sub-scores
  const llmConsensusNorm = scoreLLMConsensus(triCore);   // [0, 1]
  const llmConsensusScore = llmConsensusNorm * 100;      // [0, 100] for display
  const { score: vwapScore, deviationPct: vwapDeviationPct } = scoreVWAP(entryPrice, vwap);
  const cvdScore = scoreCVD(cvdSlope);
  const riskAdjustment = scoreRiskAdjustment(normalizedAtrPct);

  // Composite Alpha Score
  const alphaScore = clamp(
    llmConsensusNorm * W_LLM +
    vwapScore * W_VWAP +
    cvdScore * W_CVD +
    riskAdjustment * W_RISK,
    0,
    1
  );

  // Dynamic Stop Loss
  const { stopLoss, slDistanceAbs, slMethod } = computeStopLoss(
    entryPrice, direction, atr14, closes20
  );

  // TP1 = minimum acceptable R:R, TP2 = 2× that
  const tp1 =
    direction === 'Long'
      ? entryPrice + slDistanceAbs * MIN_RR
      : entryPrice - slDistanceAbs * MIN_RR;

  const tp2 =
    direction === 'Long'
      ? entryPrice + slDistanceAbs * MIN_RR * 2
      : entryPrice - slDistanceAbs * MIN_RR * 2;

  const riskReward =
    slDistanceAbs > 0
      ? parseFloat(((Math.abs(tp1 - entryPrice)) / slDistanceAbs).toFixed(2))
      : 0;

  const tier = classifyTier(alphaScore, normalizedAtrPct, riskReward);

  return {
    symbol,
    alphaScore: parseFloat(alphaScore.toFixed(4)),
    tier,
    normalizedAtrPct: parseFloat(normalizedAtrPct.toFixed(3)),
    llmConsensusScore: parseFloat(llmConsensusScore.toFixed(2)),
    stopLoss,
    slMethod,
    slDistanceAbs,
    tp1,
    tp2,
    riskReward,
    vwapDeviationPct: vwapDeviationPct != null ? parseFloat(vwapDeviationPct.toFixed(3)) : null,
    cvdSlope,
    rsi14,
    whaleConfirmed,
    vwapScore: parseFloat(vwapScore.toFixed(4)),
    cvdScore: parseFloat(cvdScore.toFixed(4)),
    riskAdjustment: parseFloat(riskAdjustment.toFixed(4)),
  };
}

/** Batch-score an array of inputs, returned in descending AlphaScore order. */
export function batchComputeAlphaMatrix(inputs: AlphaMatrixInput[]): AlphaMatrixResult[] {
  return inputs
    .map(computeAlphaMatrix)
    .sort((a, b) => b.alphaScore - a.alphaScore);
}
