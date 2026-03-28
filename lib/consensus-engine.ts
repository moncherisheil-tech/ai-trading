/**
 * Mixture of Experts (MoE) + Debate Room for Smart Money AI — Enterprise 2.0: The 6-Agent Board.
 * Runs 6 parallel experts: 1.Technician, 2.Risk Manager, 3.Market Psychologist, 4.Macro & Order Book (Groq),
 * 5.On-Chain Sleuth, 6.Deep Memory (Vector). Overseer (CEO) synthesizes all 6 into master_insight_he.
 * Baseline Final_Confidence = 1/6 per expert (~16.67% each). Dynamic override: On-Chain can be boosted by +20%
 * when Deep Memory historical accuracy for this symbol is strong; remaining weights are re-normalized.
 * Positive prediction only if ≥ threshold (default 75).
 *
 * Data flow (6+1 Board): All 6 expert outputs feed into runJudge() → master_insight_he + reasoning_path.
 * The returned ConsensusResult (including master_insight_he) is what gets saved to the DB and sent to Telegram
 * by lib/analysis-core.ts (saveDbAsync) and sendGemAlert (insightLine from master_insight_he).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { getGeminiApiKey } from '@/lib/env';
import { APP_CONFIG } from '@/lib/config';
import { listAgentInsightsBySymbol } from '@/lib/db/agent-insights';
import { getAppSettings, type AppSettings } from '@/lib/db/app-settings';
import { evaluateSystemCohesionAsync } from '@/lib/system-overseer';
import { fetchTwitterSentiment } from '@/lib/twitter-sentiment';
import { querySimilarTrades } from '@/lib/vector-db';
import { getDeepMemoryLessonBlock, DEEP_MEMORY_LESSON_001 } from '@/lib/quant/deep-memory-lessons';
import { fetchWithBackoff } from '@/lib/api-utils';
import { getExpertWeights } from '@/lib/trading/expert-weights';
import { getExpertHitRates30d } from '@/lib/db/expert-accuracy';
import {
  buildSentimentExpertAugmentation,
  buildTechnicalLiquidityAugmentation,
} from '@/lib/agents/psych-agent';
import {
  GEMINI_DEFAULT_FLASH_MODEL_ID,
  resolveGeminiModel,
  withGeminiRateLimitRetry,
} from '@/lib/gemini-model';
import { createHash } from 'crypto';

/**
 * Wall-clock cap for one MoE round. Must exceed parallel expert timeouts (each can run up to ~timeoutMs)
 * plus stagger; a 45s cap against 45s+ per-expert work caused spurious "Consensus absolute timeout".
 */
const ABSOLUTE_FAILSAFE_TIMEOUT_MS = 115_000;
/** Neutral fallback message when an expert times out or fails — never show raw error to UI. */
const NEUTRAL_FALLBACK_LOGIC = 'הנתונים אינם זמינים כרגע. ממשיכים במשקל ניטרלי.';

/** Baseline equal weight per expert: 6 agents → 1/6 each (~16.67%) before dynamic overrides. */
const WEIGHT_PER_EXPERT = 1 / 6;
const WEIGHT_TECH = WEIGHT_PER_EXPERT;
const WEIGHT_RISK = WEIGHT_PER_EXPERT;
const WEIGHT_PSYCH = WEIGHT_PER_EXPERT;
const WEIGHT_MACRO = WEIGHT_PER_EXPERT;
const WEIGHT_ONCHAIN = WEIGHT_PER_EXPERT;
const WEIGHT_DEEP_MEMORY = WEIGHT_PER_EXPERT;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const SAFE_GEMINI_FALLBACK_MODEL = resolveGeminiModel(
  APP_CONFIG.fallbackModel || GEMINI_DEFAULT_FLASH_MODEL_ID
).model.replace(/^models\//, '');
const HAWKEYE_HOT_SWAP_LATENCY_MS = 1_500;
const WATCHDOG_WINDOW = 20;
/** Fallback when options.moeConfidenceThreshold not provided; otherwise read from getAppSettings(). */
export const CONSENSUS_THRESHOLD = 75;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface RetryContext {
  symbol?: string;
  expert?: string;
  provider?: string;
}

type BoardExpertKey = 'technician' | 'risk' | 'psych' | 'macro' | 'onchain' | 'deepMemory';
type ModelProvider = 'gemini' | 'groq';
type ModelHealthStatus = 'healthy' | 'degraded' | 'unstable';
type MarketRegime = 'trending' | 'high-volatility' | 'range';

interface ProviderSample {
  ok: boolean;
  latencyMs: number;
}

const OPENAI_COMPAT_URL = (process.env.OPENAI_COMPAT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const providerHealthWindow: Record<ModelProvider, ProviderSample[]> = {
  gemini: [],
  groq: [],
};

const shadowPredictions = new Map<
  string,
  { symbol: string; priceAtPrediction: number; predictedDirection: 'bullish' | 'bearish' | 'neutral'; confidence: number }
>();
const shadowReliabilityWindow: Record<BoardExpertKey, Array<{ correct: boolean; confidence: number }>> = {
  technician: [],
  risk: [],
  psych: [],
  macro: [],
  onchain: [],
  deepMemory: [],
};

function buildDeterministicId(prefix: string, parts: Array<string | number>): string {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
  return `${prefix}_${digest}`;
}

function recordProviderSample(provider: ModelProvider, sample: ProviderSample): void {
  const buf = providerHealthWindow[provider];
  buf.push(sample);
  if (buf.length > WATCHDOG_WINDOW) buf.shift();
}

function getProviderHealth(provider: ModelProvider): {
  status: ModelHealthStatus;
  failureRatePct: number;
  p95LatencyMs: number;
} {
  const samples = providerHealthWindow[provider];
  if (samples.length === 0) return { status: 'healthy', failureRatePct: 0, p95LatencyMs: 0 };
  const failures = samples.filter((s) => !s.ok).length;
  const failureRate = (failures / samples.length) * 100;
  const latencies = [...samples].map((s) => s.latencyMs).sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0;
  const status: ModelHealthStatus =
    failureRate >= 35 || p95 >= 2_500 ? 'unstable' : failureRate >= 18 || p95 >= 1_800 ? 'degraded' : 'healthy';
  return { status, failureRatePct: Math.round(failureRate * 10) / 10, p95LatencyMs: Math.round(p95) };
}

function detectMarketRegime(input: Omit<ConsensusEngineInput, 'deep_memory_context'>): MarketRegime {
  const v = Number.isFinite(input.volatility_pct) ? input.volatility_pct : 0;
  const momentum = (input.asset_momentum ?? '').toLowerCase();
  if (v >= 4.2) return 'high-volatility';
  if (/bull|bear|trend|up|down|breakout|momentum/.test(momentum)) return 'trending';
  return 'range';
}

function scoreToDirection(score: number): 'bullish' | 'bearish' | 'neutral' {
  if (score >= 55) return 'bullish';
  if (score <= 45) return 'bearish';
  return 'neutral';
}

function shadowReliabilityBoost(expert: BoardExpertKey): number {
  const window = shadowReliabilityWindow[expert];
  if (window.length < 4) return 0;
  const correct = window.filter((w) => w.correct).length;
  const weighted = window.reduce((sum, row) => sum + (row.correct ? row.confidence : 0), 0);
  const confidenceLift = weighted / Math.max(1, window.length * 100);
  const hitRate = correct / window.length;
  return Math.max(-0.18, Math.min(0.24, (hitRate - 0.5) * 0.4 + confidenceLift * 0.2));
}

function settleAndRecordShadow(symbol: string, currentPrice: number): void {
  const prefix = `${symbol}:`;
  const keys = [...shadowPredictions.keys()].filter((k) => k.startsWith(prefix));
  for (const key of keys) {
    const pending = shadowPredictions.get(key);
    if (!pending) continue;
    const move = currentPrice - pending.priceAtPrediction;
    const actualDir = move > 0 ? 'bullish' : move < 0 ? 'bearish' : 'neutral';
    const [, expertRaw] = key.split(':');
    const expert = expertRaw as BoardExpertKey;
    const row = shadowReliabilityWindow[expert];
    row.push({
      correct: pending.predictedDirection === actualDir,
      confidence: pending.confidence,
    });
    if (row.length > WATCHDOG_WINDOW) row.shift();
    shadowPredictions.delete(key);
  }
}

function isRetryableAiError(err: unknown): boolean {
  const anyErr = err as { status?: number; code?: number; message?: string };
  const status = anyErr?.status ?? anyErr?.code;
  const msg = (anyErr?.message || String(err || '')).toString();
  if (status === 429 || status === 503) return true;
  if (/rate limit|too many requests|unavailable|temporarily down|overloaded/i.test(msg)) {
    return true;
  }
  return false;
}

async function withRetry<T>(
  action: () => Promise<T>,
  ctx: RetryContext & { maxRetries?: number }
): Promise<T> {
  const maxRetries = ctx.maxRetries ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.warn(
          `[AI-Retry] Attempt ${attempt} for symbol ${ctx.symbol ?? 'N/A'} (expert: ${
            ctx.expert ?? 'unknown'
          }, provider: ${ctx.provider ?? 'unknown'})...`
        );
      }
      return await action();
    } catch (err) {
      lastError = err;
      const retryable = isRetryableAiError(err);
      if (attempt >= maxRetries || !retryable) {
        throw err;
      }
      const backoffSeconds = 2 ** attempt;
      await sleep(backoffSeconds * 1000);
    }
  }

  // Should not reach here, but keep TypeScript happy.
  throw lastError as Error;
}

export interface ExpertTechnicianOutput {
  tech_score: number;
  tech_logic: string;
}

export interface ExpertRiskOutput {
  risk_score: number;
  risk_logic: string;
}

export interface ExpertPsychOutput {
  psych_score: number;
  psych_logic: string;
}

export interface ExpertMacroOutput {
  macro_score: number;
  macro_logic: string;
}

export interface ExpertOnChainOutput {
  onchain_score: number;
  onchain_logic: string;
}

export interface ExpertDeepMemoryOutput {
  deep_memory_score: number;
  deep_memory_logic: string;
}

type FundamentalMetricsSnapshot = {
  status: 'LIVE' | 'AWAITING_LIVE_DATA';
  summary: string;
};

export interface ConsensusEngineInput {
  symbol: string;
  current_price: number;
  rsi_14: number;
  atr_value: number | null;
  atr_pct_of_price: number | null;
  macd_signal: number | null;
  volume_profile_summary: string;
  hvn_levels: number[];
  /** Distance from current price to nearest S/R (HVN). */
  nearest_sr_distance_pct: number | null;
  volatility_pct: number;
  /** Last 3 trades context from agent_insights (Deep Memory). */
  deep_memory_context: string;
  /** For Risk + Psych: BTC trend if available. */
  btc_trend?: 'bullish' | 'bearish' | 'neutral';
  /** Asset momentum (e.g. price vs EMA20). */
  asset_momentum?: string;
  /** Enriched technical context (EMA20/50/200, Bollinger Bands, market structure). */
  technical_context?: string;
  /** Optional: Open Interest change (e.g. "+5.2%" or "rising"). */
  open_interest_signal?: string | null;
  /** Optional: Funding rate (e.g. 0.01% or "positive/negative"). */
  funding_rate_signal?: string | null;
  /** Optional: Liquidity sweep / grab context (e.g. "sweep below 65k"). */
  liquidity_sweep_context?: string | null;
  /** Optional: On-chain metric shift (e.g. exchange netflows). */
  onchain_metric_shift?: string | null;
  /** Optional: Social/sentiment dominance volume. */
  social_dominance_volume?: string | null;
  /** Leviathan context from CryptoQuant + CoinMarketCap. */
  institutional_whale_context?: string | null;
  /** Optional: Real-time Twitter/X tweets for Psych Agent (injected into prompt). */
  twitter_realtime_tweets?: string | null;
  /** Optional: USDT dominance, ETF flows, DXY (for Macro). */
  macro_context?: string | null;
  /** Optional: Order book depth summary (bids/asks, imbalance) for Macro & Technician. */
  order_book_summary?: string | null;
}

export interface ConsensusResult {
  tech_score: number;
  risk_score: number;
  psych_score: number;
  macro_score: number;
  onchain_score: number;
  deep_memory_score: number;
  tech_logic: string;
  risk_logic: string;
  psych_logic: string;
  macro_logic: string;
  onchain_logic: string;
  deep_memory_logic: string;
  /** True when Macro agent (Groq) failed and score used fallback. */
  macro_fallback_used?: boolean;
  /** True when On-Chain Sleuth failed and score used fallback. */
  onchain_fallback_used?: boolean;
  /** True when Deep Memory (Vector) agent failed and score used fallback. */
  deep_memory_fallback_used?: boolean;
  master_insight_he: string;
  reasoning_path: string;
  final_confidence: number;
  /** Only true when final_confidence >= CONSENSUS_THRESHOLD. */
  consensus_approved: boolean;
  /** When the board is polarized, Overseer synthesizes opposing camps. */
  debate_resolution?: string;
  decision_id?: string;
  vote_ids?: Partial<Record<BoardExpertKey, string>>;
  market_regime?: MarketRegime;
  active_board_weights?: Partial<Record<BoardExpertKey, number>>;
  model_watchdog?: {
    gemini: { status: ModelHealthStatus; failureRatePct: number; p95LatencyMs: number };
    groq: { status: ModelHealthStatus; failureRatePct: number; p95LatencyMs: number };
  };
}

export interface ConsensusMockPayload {
  tech: ExpertTechnicianOutput;
  risk: ExpertRiskOutput;
  psych: ExpertPsychOutput;
  macro: ExpertMacroOutput;
  onchain: ExpertOnChainOutput;
  deepMemory: ExpertDeepMemoryOutput;
  judge: { master_insight_he: string; reasoning_path: string };
}

function normalizeSymbol(s: string): string {
  const u = (s || '').toUpperCase().trim();
  return u.endsWith('USDT') ? u : `${u}USDT`;
}

/** Simple EMA for MACD. */
function ema(arr: number[], period: number): number | null {
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let val = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < arr.length; i++) {
    val = arr[i]! * k + val * (1 - k);
  }
  return val;
}

/** MACD signal (histogram): EMA12 - EMA26, then signal line EMA9 of that; return MACD - Signal. */
export function computeMacdSignal(closes: number[]): number | null {
  if (closes.length < 35) return null;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  if (ema12 == null || ema26 == null) return null;
  const macdLine = ema12 - ema26;
  const macdValues: number[] = [];
  for (let i = 26; i < closes.length; i++) {
    const e12 = ema(closes.slice(0, i + 1), 12);
    const e26 = ema(closes.slice(0, i + 1), 26);
    if (e12 != null && e26 != null) macdValues.push(e12 - e26);
  }
  if (macdValues.length < 9) return macdLine;
  const signalLine = ema(macdValues, 9);
  if (signalLine == null) return macdLine;
  return macdLine - signalLine;
}

/** Re-export for consumers; canonical definition in lib/quant/deep-memory-lessons.ts */
export { DEEP_MEMORY_LESSON_001 } from '@/lib/quant/deep-memory-lessons';

const COINGECKO_ID_BY_TICKER: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
};

const DEFILLAMA_SLUG_BY_TICKER: Record<string, string> = {
  ETH: 'ethereum',
  SOL: 'solana',
};

async function fetchFundamentalMetrics(symbol: string): Promise<FundamentalMetricsSnapshot> {
  const normalized = normalizeSymbol(symbol);
  const ticker = normalized.endsWith('USDT') ? normalized.slice(0, -4) : normalized;
  const coingeckoId = COINGECKO_ID_BY_TICKER[ticker];
  if (!coingeckoId) {
    return {
      status: 'AWAITING_LIVE_DATA',
      summary: `Fundamental feed awaiting mapping for ${ticker}.`,
    };
  }

  const coingeckoUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coingeckoId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
  const defillamaSlug = DEFILLAMA_SLUG_BY_TICKER[ticker];
  const tvlUrl = defillamaSlug
    ? `https://api.llama.fi/protocol/${encodeURIComponent(defillamaSlug)}`
    : null;
  const glassnodeApiKey = (process.env.GLASSNODE_API_KEY || '').trim();
  const activeAddressUrl = glassnodeApiKey
    ? `https://api.glassnode.com/v1/metrics/addresses/active_count?a=${encodeURIComponent(ticker)}&i=24h&api_key=${encodeURIComponent(glassnodeApiKey)}`
    : null;

  try {
    const [coingeckoRes, tvlRes, activeRes] = await Promise.all([
      fetchWithBackoff(coingeckoUrl, { timeoutMs: APP_CONFIG.fetchTimeoutMs, maxRetries: 2, cache: 'no-store' }),
      tvlUrl ? fetchWithBackoff(tvlUrl, { timeoutMs: APP_CONFIG.fetchTimeoutMs, maxRetries: 2, cache: 'no-store' }) : Promise.resolve(null),
      activeAddressUrl ? fetchWithBackoff(activeAddressUrl, { timeoutMs: APP_CONFIG.fetchTimeoutMs, maxRetries: 2, cache: 'no-store' }) : Promise.resolve(null),
    ]);
    if (!coingeckoRes.ok) {
      return {
        status: 'AWAITING_LIVE_DATA',
        summary: `Coingecko fundamentals unavailable for ${ticker} (${coingeckoRes.status}).`,
      };
    }
    const coingeckoData = (await coingeckoRes.json()) as {
      market_data?: {
        market_cap?: { usd?: number };
        fully_diluted_valuation?: { usd?: number };
        circulating_supply?: number;
        total_supply?: number;
      };
    };
    const marketCap = coingeckoData.market_data?.market_cap?.usd;
    const fdv = coingeckoData.market_data?.fully_diluted_valuation?.usd;
    const circulating = coingeckoData.market_data?.circulating_supply;
    const totalSupply = coingeckoData.market_data?.total_supply;

    let tvlText = 'TVL: awaiting live protocol mapping.';
    if (tvlRes?.ok) {
      const tvlData = (await tvlRes.json()) as { tvl?: number };
      const tvl = typeof tvlData.tvl === 'number' ? tvlData.tvl : null;
      tvlText = tvl != null ? `TVL: ${Math.round(tvl).toLocaleString()} USD.` : 'TVL: live endpoint returned no value.';
    } else if (tvlUrl != null) {
      tvlText = `TVL feed unavailable (${tvlRes?.status ?? 'n/a'}).`;
    }

    let activeText = 'Active addresses: awaiting live provider key.';
    if (activeRes?.ok) {
      const activeData = (await activeRes.json()) as Array<{ v?: number; t?: number }>;
      const latest = Array.isArray(activeData) && activeData.length > 0 ? activeData[activeData.length - 1] : null;
      activeText =
        typeof latest?.v === 'number'
          ? `Active addresses (24h): ${Math.round(latest.v).toLocaleString()}.`
          : 'Active addresses: live endpoint returned no value.';
    } else if (activeAddressUrl != null) {
      activeText = `Active addresses feed unavailable (${activeRes?.status ?? 'n/a'}).`;
    }

    const summary =
      `Tokenomics: market cap=${Number.isFinite(marketCap) ? Math.round(marketCap as number).toLocaleString() : 'n/a'} USD, ` +
      `FDV=${Number.isFinite(fdv) ? Math.round(fdv as number).toLocaleString() : 'n/a'} USD, ` +
      `circulating=${Number.isFinite(circulating) ? Math.round(circulating as number).toLocaleString() : 'n/a'}, ` +
      `totalSupply=${Number.isFinite(totalSupply) ? Math.round(totalSupply as number).toLocaleString() : 'n/a'}. ` +
      `${tvlText} ${activeText}`;
    return { status: 'LIVE', summary };
  } catch (error) {
    return {
      status: 'AWAITING_LIVE_DATA',
      summary: `Fundamental metrics unavailable for ${ticker}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Build Deep Memory context from last 3 agent_insights for this symbol + Vector DB (Pinecone) similar trades.
 * Injected into Expert 1 (Tech) and Expert 2 (Risk). If Pinecone fails, uses standard DB only.
 * Static Lesson 001 (Respect On-Chain and OI over RSI) is prepended via getDeepMemoryLessonBlock().
 */
export async function getDeepMemoryContext(symbol: string): Promise<string> {
  const normalized = normalizeSymbol(symbol);
  const lessonBlock = getDeepMemoryLessonBlock();
  let baseContext: string;
  try {
    const insights = await listAgentInsightsBySymbol(normalized, 3);
    if (insights.length === 0) {
      baseContext = 'אין היסטוריית תובנות קודמת עבור סמל זה.';
    } else {
      const wins = insights.filter(
        (i) =>
          i.insight &&
          (i.insight.includes('הצליחה') || i.insight.includes('רווח') || i.insight.includes('יעד'))
      ).length;
      const winRatePct = Math.round((wins / insights.length) * 100);
      const failurePoints = insights
        .filter(
          (i) =>
            i.insight &&
            (i.insight.includes('נכשלה') ||
              i.insight.includes('סטופ לוס') ||
              i.insight.includes('ניקוי') ||
              i.insight.includes('כשלון'))
        )
        .map((i) => i.insight?.slice(0, 120) ?? '')
        .filter(Boolean);
      const failureSummary =
        failurePoints.length > 0
          ? failurePoints.join(' | ')
          : 'אין תיעוד כשלונות ברור.';
      const postMortemParts = insights
        .filter((i) => i.why_win_lose || i.agent_verdict)
        .slice(0, 3)
        .map((i) => [i.why_win_lose, i.agent_verdict].filter(Boolean).join(' | '))
        .filter(Boolean);
      const postMortemBlock = postMortemParts.length > 0 ? ` תחקירי פוסט-מורטם (RAG): ${postMortemParts.join('; ')}.` : '';
      baseContext = `הקשר: 3 העסקאות האחרונות בסמל זה — שיעור הצלחה ${winRatePct}%. נקודות כישלון קודמות: ${failureSummary}.${postMortemBlock} התאם את הניתוח הנוכחי כדי להימנע מחזרה על טעויות.`;
    }
  } catch {
    baseContext = 'שגיאה בטעינת היסטוריית תובנות — המשך ללא הקשר עבר.';
  }

  try {
    const similarTrades = await querySimilarTrades(normalized, 3);
    if (similarTrades.length > 0) {
      const ragBlock = similarTrades.map((h) => h.text).join('; ');
      return `${lessonBlock}${baseContext} Deep Memory (Vector DB): עסקאות דומות מהעבר: ${ragBlock}.`;
    }
  } catch {
    // Pinecone timeout or error — bypass silently; baseContext is sufficient.
  }
  return lessonBlock + baseContext;
}

function withTimeout<T>(p: Promise<T>, ms: number | null | undefined): Promise<T> {
  const safeMs = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 60_000;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Consensus timeout')), safeMs)),
  ]);
}

function settleNow<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise
    .then((value) => ({ status: 'fulfilled', value } as const))
    .catch((reason) => ({ status: 'rejected', reason } as const));
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}') + 1;
  if (start >= 0 && end > start) return trimmed.slice(start, end);
  return trimmed;
}

function buildInvalidJsonError(context: string, raw: string, parseErr: unknown): Error {
  const parseMessage = parseErr instanceof Error ? parseErr.message : String(parseErr);
  const preview = (raw ?? '').trim().slice(0, 280);
  const detail = preview ? `${context} returned non-JSON payload: ${preview}` : `${context} returned empty/non-JSON payload.`;
  return new Error(`${detail} (parse error: ${parseMessage})`);
}

function buildLocalFallbackObject<T>(fieldNames: string[], reason: string): T {
  const out: Record<string, unknown> = {};
  for (const key of fieldNames) {
    if (/_score$/i.test(key)) out[key] = 50;
    else if (/confidence/i.test(key)) out[key] = 50;
    else if (/consensus_approved|executed/i.test(key)) out[key] = false;
    else if (/status/i.test(key)) out[key] = 'fallback-local';
    else out[key] = `Local fallback engaged: ${reason}`;
  }
  return out as T;
}

async function callOpenAiCompatJson<T>(
  prompt: string,
  fieldNames: string[],
  timeoutMs: number
): Promise<T> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_MISSING_KEY');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.min(timeoutMs, HAWKEYE_HOT_SWAP_LATENCY_MS));
  try {
    const started = Date.now();
    const res = await fetch(`${OPENAI_COMPAT_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: CONSENSUS_SYSTEM_INSTRUCTION },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    const rawJson = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = rawJson.choices?.[0]?.message?.content?.trim() ?? '';
    if (!res.ok || !raw) throw new Error(`OPENAI_FAIL_${res.status}`);
    recordProviderSample('gemini', { ok: true, latencyMs: Date.now() - started });
    const sanitized = extractJson(raw).replace(/[\u0000-\u001F]+/g, ' ');
    return JSON.parse(sanitized) as T;
  } catch (err) {
    recordProviderSample('gemini', { ok: false, latencyMs: HAWKEYE_HOT_SWAP_LATENCY_MS });
    throw buildInvalidJsonError('OpenAI fallback', String(err), err);
  } finally {
    clearTimeout(t);
  }
}

/** System instruction at model level: strict JSON-only output to avoid contradictory structures and hallucinated fields. */
const CONSENSUS_SYSTEM_INSTRUCTION =
  'You must output ONLY a raw JSON object. Do not include markdown formatting like ```json or ```. Do not include any introductory text, explanation, or text after the JSON. Output exactly the requested keys and nothing else.';

/** Expert rule: EMAs and Bollinger Bands are always provided in technical_context — never say "missing data" or "לא זמין" for them. */
const NO_MISSING_EMA_BB_RULE =
  'CRITICAL: EMAs (e.g. EMA20/50/200) and Bollinger Bands are provided in technical_context. Do NOT say "missing data", "data not available", "לא זמין" or "חסר" for EMAs or Bollinger Bands — use the values from technical_context.';

async function callGeminiJson<T>(
  prompt: string,
  fieldNames: string[],
  _model: string,
  timeoutMs: number,
  retryMeta?: RetryContext
): Promise<T> {
  const apiKey = getGeminiApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  const schemaDesc = fieldNames.map((k) => `"${k}"`).join(', ');
  let fullPrompt = `${prompt}\n\nחובה: החזר רק אובייקט JSON גולמי עם השדות: ${schemaDesc}. אסור markdown (למשל \`\`\`json). אסור טקסט מקדים או מסביר.`;
  fullPrompt += "\n\nCRITICAL JSON FORMATTING RULES:\n1. Output strictly valid JSON.\n2. DO NOT use unescaped double quotes (\") inside string values. If you need to quote a word inside the text, use single quotes (') instead.\n3. Ensure all properties and string values are properly closed.";
  const generateWithModel = async (modelName: string): Promise<string> => {
    const selectedModel = resolveGeminiModel(modelName);
    const generativeModel = genAI.getGenerativeModel(
      {
        model: selectedModel.model,
      },
      selectedModel.requestOptions
    );
    const started = Date.now();
    try {
      const res = await withRetry(
        () =>
          withGeminiRateLimitRetry(() =>
            withTimeout(
              generativeModel.generateContent({
                contents: [
                  { role: 'user', parts: [{ text: CONSENSUS_SYSTEM_INSTRUCTION }] },
                  { role: 'user', parts: [{ text: fullPrompt }] },
                ],
                generationConfig: {
                  temperature: 0.25,
                  maxOutputTokens: 8192,
                },
              }),
              timeoutMs
            )
          ),
        { ...retryMeta, provider: `Gemini(${selectedModel.model})` }
      );
      recordProviderSample('gemini', { ok: true, latencyMs: Date.now() - started });
      return res.response.text()?.trim() ?? '';
    } catch (err) {
      recordProviderSample('gemini', { ok: false, latencyMs: Date.now() - started });
      throw err;
    }
  };

  const primaryModel = _model || SAFE_GEMINI_FALLBACK_MODEL;
  const secondaryModel = SAFE_GEMINI_FALLBACK_MODEL;
  let raw = '';
  try {
    try {
      raw = await Promise.race([
        generateWithModel(primaryModel),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`HAWKEYE_LATENCY_THRESHOLD:${HAWKEYE_HOT_SWAP_LATENCY_MS}`)), HAWKEYE_HOT_SWAP_LATENCY_MS)
        ),
      ]);
    } catch (firstErr) {
      // Tier-0 failover chain: OpenAI -> Gemini fallback -> local deterministic fallback.
      const openAiOut = await callOpenAiCompatJson<T>(fullPrompt, fieldNames, timeoutMs).catch(() => null);
      if (openAiOut) return openAiOut;
      throw firstErr;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const shouldSwap =
      /HAWKEYE_LATENCY_THRESHOLD/i.test(msg) ||
      /timeout|rate|unavailable|503|429|404|not found/i.test(msg);
    if (!shouldSwap) {
      return buildLocalFallbackObject<T>(fieldNames, msg);
    }
    try {
      raw = await generateWithModel(secondaryModel);
    } catch (secondErr) {
      const secondMsg = secondErr instanceof Error ? secondErr.message : String(secondErr);
      return buildLocalFallbackObject<T>(fieldNames, secondMsg);
    }
  }

  let jsonStr = raw;

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/(?:\r?\n)?\s*```\s*$/, '').trim();
  }
  jsonStr = extractJson(jsonStr);

  // Sanitize: strip raw control characters (e.g. literal newlines/tabs inside strings) that cause "Bad control character in string literal"
  jsonStr = jsonStr.replace(/[\u0000-\u001F]+/g, ' ');

  try {
    return JSON.parse(jsonStr) as T;
  } catch (parseErr) {
    const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    const isUnterminated = /unterminated|unexpected end|end of (data|input)/i.test(errMsg);
    if (process.env.NODE_ENV === 'development') {
      console.error('[ConsensusEngine] JSON parse failed', {
        error: errMsg,
        rawLength: raw.length,
        rawPreview: raw.slice(0, 80) + (raw.length > 80 ? '…' : ''),
        hint: isUnterminated ? 'Response may be truncated.' : undefined,
      });
    } else {
      console.error('[ConsensusEngine] JSON parse failed', { error: errMsg, rawLength: raw.length });
    }
    throw buildInvalidJsonError('Gemini expert', raw, parseErr);
  }
}

/**
 * Expert 1: The Technician — Hedge-fund grade. Liquidity Sweeps, Fair Value Gaps (FVG), Order Block Mitigation.
 */
async function runExpertTechnician(
  input: ConsensusEngineInput,
  model: string,
  timeoutMs: number
): Promise<ExpertTechnicianOutput> {
  const oi = input.open_interest_signal ?? 'לא צוין';
  const funding = input.funding_rate_signal ?? 'לא צוין';
  const sweeps = input.liquidity_sweep_context ?? 'לא צוין';
  const techCtx = input.technical_context ?? 'לא צוין';
  const liquidityBlock = buildTechnicalLiquidityAugmentation();
  const prompt = `You are the Technical Expert in a hedge-fund grade MoE. Your domain: Liquidity Sweeps, Fair Value Gaps (FVG), and Order Block Mitigation. Output in professional Hebrew; no generic chatbot language.

${NO_MISSING_EMA_BB_RULE}

${liquidityBlock}

Input: Symbol ${input.symbol}, price ${input.current_price}, RSI(14)=${input.rsi_14}, MACD_signal=${input.macd_signal ?? 'N/A'}, Volume profile: ${input.volume_profile_summary}. HVN (S/R): ${input.hvn_levels.join(', ') || 'none'}. Momentum vs EMA: ${input.asset_momentum ?? 'N/A'}. Technical context: ${techCtx}. Open Interest: ${oi}. Funding: ${funding}. Liquidity context: ${sweeps}. Order book depth: ${input.order_book_summary ?? 'לא צוין'}.
${input.deep_memory_context}

Mandate: (1) TREND (EMA200) is the top priority: use technical_context for EMA200. If Price > EMA200, the regime is bullish — Bearish predictions require MUCH higher conviction and MULTIPLE exhaustion signals (e.g. clear distribution, failed breakout, reversal structure); do not flip Bearish solely on RSI overbought or single indicator. (2) Liquidity Sweeps — identify whether recent price action has swept equal highs/lows or swept liquidity below support / above resistance before reversal (stop-hunt); score higher when sweep is complete and structure supports continuation. (3) Fair Value Gaps (FVG) — note any unfilled FVGs (bullish/bearish) and whether price is respecting or filling them; use for entry zones. (4) Order Block Mitigation — assess if order blocks (last bullish/bearish candle before a move) are mitigated or still in play; precise entry zones around OB + FVG. (5) HVN and volume profile define institutional levels; align entries with OB mitigation and FVG fill. (6) OI and funding: divergence vs price = caution; confirmation = higher score.
Output: tech_score (0-100) and tech_logic (Hebrew, concise: liquidity sweep verdict, FVG/OB context, entry zone). JSON only: tech_score, tech_logic.`;
  const out = await callGeminiJson<ExpertTechnicianOutput>(
    prompt,
    ['tech_score', 'tech_logic'],
    model,
    timeoutMs,
    { symbol: input.symbol, expert: 'Technician' }
  );
  const tech_score = Math.max(0, Math.min(100, Number(out.tech_score) || 50));
  return { tech_score, tech_logic: String(out.tech_logic || 'ללא נימוק').slice(0, 500) };
}

/** R:R minimum by risk tolerance (God-Mode). */
const RISK_RR_BY_LEVEL: Record<string, string> = {
  strict: '1:3',
  moderate: '1:2',
  aggressive: '1:1.5',
};

/**
 * Expert 2: The Risk & Market-Making Manager — Institutional Grade v2.1.
 * Focus: realized/expected volatility, Kelly-based position sizing and drawdown protection with hard risk limits.
 * Mandatory R:R minimum by riskToleranceLevel (strict 1:3, moderate 1:2, aggressive 1:1.5).
 */
async function runExpertRisk(
  input: ConsensusEngineInput,
  model: string,
  timeoutMs: number,
  riskToleranceLevel?: 'strict' | 'moderate' | 'aggressive'
): Promise<ExpertRiskOutput> {
  const rrMin = riskToleranceLevel ? RISK_RR_BY_LEVEL[riskToleranceLevel] ?? '1:3' : '1:3';
  const atrPct = input.atr_pct_of_price?.toFixed(2) ?? '?';
  const institutional = input.institutional_whale_context ?? 'לא צוין';
  const prompt = `אתה Institutional Crypto Quantitative Analyst — מנהל סיכונים ומרקט-מייקינג מוסדי (Risk/MM Expert). תפקידך: ניהול סיכונים, הקצאת גודל פוזיציה ושרידות התיק בלבד (לא צ'אט כללי). השתמש בשפה מקצועית קריפטו-נייטיבית בעברית.

${NO_MISSING_EMA_BB_RULE}

נתונים: סמל ${input.symbol}, מחיר ${input.current_price}, ATR=${input.atr_value ?? 'לא זמין'}, ATR% מהמחיר=${atrPct}%, מרחק ל-S/R הקרוב (%)=${input.nearest_sr_distance_pct?.toFixed(2) ?? '?'}, תנודתיות реализד/משוערת (%)=${input.volatility_pct.toFixed(2)}.
Leviathan (CryptoQuant + CoinMarketCap): ${institutional}
${input.deep_memory_context}

כללים: (1) Volatility — נתח תנודתיות באמצעות ATR וסטיית תקן (סטיית תקן משתמעת/היסטורית אם עולה מן ההקשר): ATR% גבוה או סטיית תקן קיצונית → הקטן גודל פוזיציה וציון. (2) Position Sizing — חשב גודל פוזיציה נאות ביחס להון על בסיס Kelly Criterion משוער (Full/half Kelly): אם ה־Kelly fraction מרמז על הקצאה <1% מההון, ציין זאת במפורש והורד ציון. (3) יחס סיכון/תגמול (R:R) מינימלי חובה ${rrMin}; אם R:R נמוך — risk_score ≤ 40 ו"דחייה: R:R מתחת ל־${rrMin}". (4) Drawdown Protection — הערך איך SL מוגדר ביחס ל־max drawdown סביר לתיק; מבנה שיכול לגרור גרירת סטופס סדרתית או drawdown חד → ציון נמוך. (5) Slippage ו-Spread — חשב רווחיות לאחר החלקה ועמלות; נזילות רדודה/ספר לא רציף = risk_score נמוך. (6) Hard Stop Loss ברור חובה; ללא SL או SL רחוק מדי ⇢ הורד ציון. (7) ציון 100 רק כאשר R:R≥${rrMin}, SL/TP מתואמים לתנודתיות, וגודל הפוזיציה עקבי עם Kelly ועם מגבלת drawdown.
החזר risk_score (0-100) והסבר ב־risk_logic בעברית (Volatility/ATR/סטיית תקן, Kelly position sizing, R:R, Drawdown protection, Slippage/Spread, Hard Stop). החזר JSON בלבד: risk_score, risk_logic.`;
  const out = await callGeminiJson<ExpertRiskOutput>(
    prompt,
    ['risk_score', 'risk_logic'],
    model,
    timeoutMs,
    { symbol: input.symbol, expert: 'Risk' }
  );
  const risk_score = Math.max(0, Math.min(100, Number(out.risk_score) ?? 50));
  return { risk_score, risk_logic: String(out.risk_logic || 'ללא נימוק').slice(0, 500) };
}

/**
 * Expert 3: The Sentiment & Perps Microstructure Analyst (Market Psychologist) — Institutional Grade v2.1.
 * Focus: funding rates, liquidations heatmaps, social volume/dominance and contrarian sentiment setups.
 */
async function runExpertPsych(
  input: ConsensusEngineInput,
  model: string,
  timeoutMs: number
): Promise<ExpertPsychOutput> {
  const onchain = input.onchain_metric_shift ?? 'לא צוין';
  const social = input.social_dominance_volume ?? 'לא צוין';
  const twitterTweets = input.twitter_realtime_tweets ?? 'לא צוין';
  const funding = input.funding_rate_signal ?? 'לא צוין';
  const oi = input.open_interest_signal ?? 'לא צוין';
  const psychTruthBlock = buildSentimentExpertAugmentation();
  const prompt = `אתה Institutional Crypto Quantitative Analyst — מומחה Sentiment ו-PERP Microstructure מוסדי (The Market Psychologist). תפקידך: ניתוח סנטימנט, מימון (Funding), ליקווידציות ונפח סושיאל בלבד (לא צ'אט כללי). השתמש בשפה מקצועית קריפטו-נייטיבית בעברית.

${NO_MISSING_EMA_BB_RULE}

${psychTruthBlock}

חשוב: אל תשתמש ב-RSI, MACD, FVG או הוראות טכניות מהטכנאי — אלה נשארים אצל מומחה הטכני בלבד. אל תסיק סנטימנט מספרי מחיר או אינדיקטורים שלא הופיעו בנתוני סושיאל/on-chain/funding/OI שלהלן.

נתונים: סמל ${input.symbol}, מחיר ${input.current_price}. טרנד BTC: ${input.btc_trend ?? 'לא צוין'}. מומנטום הנכס (תיאור בלבד, לא לציון טכני): ${input.asset_momentum ?? 'לא צוין'}.
מדדים: שינויי מדדים on-chain: ${onchain}. נפח/דומיננטיות סושיאל: ${social}. Funding Rates/Perps: ${funding}. Open Interest: ${oi}.
טוויטר/סושיאל בזמן אמת (Real-time): ${twitterTweets}
${input.deep_memory_context}

כללים: (1) Funding Rates — זהה מימון חיובי קיצוני כ"רוויה לונגים" ומימון שלילי קיצוני כ"רוויה שורטים"; מצבי Funding crowded = סיגנל קונטרארי. (2) Liquidations Heatmaps — התייחס לאזורי ריכוז ליקווידציות (clustered liquidations) מעל/מתחת למחיר; אם תרחיש העסקה דורש "לרדוף" אחרי ליקווידציות פתוחות, הורד ציון. (3) Euphoria/FOMO מול פחד לא מוצדק — זהה תאוות קנייה, הייפ, "כולם קונים" מול פאניקה כש-fundamentals לא תומכים. (4) Setups קונטראריים: Euphoria בעדר + Funding חיובי קיצוני + ליקווידציות לונגים פתוחות = דחייה/ציון נמוך; פחד לא מוצדק + Funding נייטרלי/שלילי + ליקווידציות שורטים מעל = ציון גבוה (silent accumulation). (5) Smart Money vs Retail: צבירה שקטה = גבוה; FOMO/distribution/עדר = נמוך. (6) Social dominance volume — נפח/דומיננטיות בסושיאל/חדשות; הייפ מוחלט vs שקט = התאמה לקונטרארי. (7) טוויטר/סושיאל בזמן אמת — השתמש בציטוטים לעיל כדי לבסס את psych_score על מדדי סושיאל חיים ולא רק על תיאוריה כללית. (8) הגדר במפורש: FOMO distribution / silent accumulation / פחד לא מוצדק (קונטרארי). (9) Open Interest — השתמש ב-OI כפרוקסי להשתתפות השוק (market participation) ו"עסקאות צפופות" (Crowded Trades): OI עולה עם מחיר = כניסת כסף חדש/לחץ; OI יורד = סגירת פוזיציות או ליקווידציות; OI גבוה יציב עם מחיר חלש = סיכון ללונגים צפופים.
החזר psych_score (0-100) והסבר ב־psych_logic בעברית (Funding, Liquidations heatmap/high-risk zones, Euphoria/פחד, on-chain, סושיאל, טוויטר, accumulation/distribution, OI). החזר JSON בלבד: psych_score, psych_logic.`;
  const out = await callGeminiJson<ExpertPsychOutput>(
    prompt,
    ['psych_score', 'psych_logic'],
    model,
    timeoutMs,
    { symbol: input.symbol, expert: 'Psych' }
  );
  const psych_score = Math.max(0, Math.min(100, Number(out.psych_score) ?? 50));
  return { psych_score, psych_logic: String(out.psych_logic || 'ללא נימוק').slice(0, 500) };
}

/** Extract first top-level JSON object from text (handles "Here is the JSON: {...}" and markdown-wrapped). */
function extractFirstJsonObject(text: string): string {
  const trimmed = text.trim();
  // Strip markdown code fences first
  let str = trimmed;
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*\n?/i, '').replace(/(?:\r?\n)?\s*```\s*$/, '').trim();
  }
  const start = str.indexOf('{');
  if (start < 0) return str;
  let depth = 0;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  // Unbalanced: fallback to first { to last }
  const end = str.lastIndexOf('}') + 1;
  return end > start ? str.slice(start, end) : str.slice(start);
}

/** Safely parse Groq JSON: extract object from conversational text, strip markdown/code fences, validate shape. */
function parseMacroJson(raw: string): ExpertMacroOutput {
  const str = raw.trim();
  if (!str) throw new Error('Empty response');

  let jsonStr = extractFirstJsonObject(str);

  // Sanitize: strip raw control characters that can cause "Bad control character in string literal"
  jsonStr = jsonStr.replace(/[\u0000-\u001F]+/g, ' ');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[ConsensusEngine] Groq macro JSON parse failed', {
      error: msg,
      ...(process.env.NODE_ENV === 'development' && { rawPreview: raw.slice(0, 80) + (raw.length > 80 ? '…' : '') }),
    });
    throw buildInvalidJsonError('Groq macro expert', raw, e);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Response is not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const macro_score = Number(obj.macro_score);
  const macro_logic = typeof obj.macro_logic === 'string' ? obj.macro_logic : String(obj.macro_logic ?? '');
  const score = Number.isFinite(macro_score) ? Math.max(0, Math.min(100, macro_score)) : 50;
  return { macro_score: score, macro_logic: macro_logic.slice(0, 500) };
}

/** Gemini model used when Groq Macro agent hits 429 rate limit; keeps all 6 experts active. */
const GEMINI_MACRO_FALLBACK_MODEL = resolveGeminiModel(
  APP_CONFIG.fallbackModel || GEMINI_DEFAULT_FLASH_MODEL_ID
).model.replace(/^models\//, '');

/**
 * Run the Macro Expert once with global context only (DXY, Fear & Greed). Used by the scanner to pre-fetch
 * macro summary once per cycle and reuse for all symbols, avoiding 12 Groq calls and rate limits.
 */
export async function runGlobalMacroExpertOnce(
  macroContextStr: string,
  orderBookSummary?: string | null
): Promise<ExpertMacroOutput> {
  const minimalInput: ConsensusEngineInput = {
    symbol: 'GLOBAL',
    current_price: 0,
    rsi_14: 50,
    atr_value: null,
    atr_pct_of_price: null,
    macd_signal: null,
    volume_profile_summary: 'לא רלוונטי (הקשר גלובלי).',
    hvn_levels: [],
    nearest_sr_distance_pct: null,
    volatility_pct: 0,
    deep_memory_context: 'הקשר מקרו גלובלי — אין היסטוריית סמל ספציפי.',
    macro_context: macroContextStr,
    order_book_summary: orderBookSummary ?? null,
    open_interest_signal: null,
  };
  const timeoutMs = Math.max(45_000, Math.min(60_000, 55_000));
  return runExpertMacro('GLOBAL', minimalInput, timeoutMs, GEMINI_MACRO_FALLBACK_MODEL);
}

/**
 * Expert 4: The Macro & Order Book Analyst (Groq / Llama 3).
 * Analyzes whale spoofing, order book walls, liquidity sweeps, macro correlations (DXY, rates).
 * On Groq 429 (rate limit): DO NOT RETRY — switch to Gemini immediately on first failure.
 */
async function runExpertMacro(
  symbol: string,
  data: ConsensusEngineInput,
  timeoutMs: number,
  geminiFallbackModel?: string
): Promise<ExpertMacroOutput> {
  const macroCtx = data.macro_context ?? 'לא צוין';
  const orderBookCtx = data.order_book_summary ?? 'לא צוין';
  const oiSignal = data.open_interest_signal ?? 'לא צוין';
  const dataSummary = [
    `symbol: ${data.symbol}`,
    `current_price: ${data.current_price}`,
    `RSI(14): ${data.rsi_14}`,
    `ATR%: ${data.atr_pct_of_price ?? 'N/A'}`,
    `volatility_pct: ${data.volatility_pct}`,
    `volume_profile: ${data.volume_profile_summary}`,
    `HVN levels: ${data.hvn_levels.join(', ') || 'N/A'}`,
    `nearest_sr_distance_pct: ${data.nearest_sr_distance_pct ?? 'N/A'}`,
    `btc_trend: ${data.btc_trend ?? 'N/A'}`,
    `macro_context (USDT dominance, ETF flows, DXY, Fear & Greed): ${macroCtx}`,
    `order_book_summary: ${orderBookCtx}`,
    `open_interest: ${oiSignal}`,
  ].join('; ');
  const userPrompt = `You are the Macro Expert in a hedge-fund grade MoE. Domain: DXY correlation, yield curves, FED pivot expectations, and order book liquidity. Output in professional Hebrew; no generic chatbot language.

Focus: (1) DXY Correlation — inverse correlation with risk assets; DXY strength = headwind for crypto; DXY breakdown/weakness = tailwind; note regime (range vs trend). (2) Yield Curves — 2s10s inversion, front-end vs long-end; implications for liquidity and risk appetite; curve steepening post-inversion often precedes risk-on. (3) FED Pivot expectations — market-implied vs your read; earlier pivot = bullish for crypto; "higher for longer" = pressure; data dependency (CPI, NFP) and how it affects the setup. (4) When macro_context is provided (USDT dominance, ETF flows, Fear & Greed, BTC dominance), integrate: USDT dominance down = liquidity into crypto; ETF net inflows = institutional demand; outflows = selling pressure; Fear & Greed extreme fear = potential reversal, extreme greed = caution. (5) Order book — when order_book_summary is provided, use bid/ask imbalance and spread: bid-heavy = support, ask-heavy = resistance; thin spread = liquidity; use alongside macro. (6) Open Interest — use OI as a proxy for market participation and "Crowded Trades": rising OI with price = new money/leverage; falling OI = unwinding or liquidations; elevated OI in a weak market = crowded long risk. (7) SPOOFING / LIQUIDITY DECAY — flag likely spoofed walls (size vanishes as price tests the level); do not validate breakouts on evaporating depth; integrate with Psych Truth Matrix when headlines conflict with book integrity.

Data: ${dataSummary}

Output ONLY a raw JSON object. No markdown, no intro. Keys exactly: macro_score (0-100), macro_logic (string, Hebrew). Higher score = macro tailwind for the trade.`;

  const envVarName = 'GROQ_API_KEY';
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    console.error('[CRITICAL] Grok/Groq API key missing during Macro expert initialization. Expected GROQ_API_KEY.');
    console.error(`[ConsensusEngine] Missing Groq API key; attempted env var: ${envVarName}`);
    console.warn('[ConsensusEngine] GROQ_API_KEY missing; Macro agent skipped.');
    return {
      macro_score: 50,
      macro_logic: 'סוכן Groq (מקרו/Order Book) הושבת — מפתח API חסר. המערכת עוקפת ומשתמשת בשלושת סוכני Gemini בלבד; ציון מקרו 50.',
    };
  }
  const groq = new Groq({ apiKey });

  try {
    const started = Date.now();
    // Single attempt only: on 429 do NOT retry — switch to Gemini immediately (see catch below).
    const completion = await Promise.race([
      groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are the Macro Expert: DXY correlation, yield curves, FED pivot expectations. Professional Hebrew. Output ONLY a raw JSON object. No markdown, no intro. Keys: macro_score (0-100), macro_logic (string).',
          },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.25,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('Groq macro timeout')), Math.min(timeoutMs, HAWKEYE_HOT_SWAP_LATENCY_MS))
      ),
    ]);
    recordProviderSample('groq', { ok: true, latencyMs: Date.now() - started });
    const raw = completion.choices?.[0]?.message?.content?.trim() ?? '';
    if (!raw) throw new Error('Empty Groq response');
    return parseMacroJson(raw);
  } catch (err) {
    recordProviderSample('groq', { ok: false, latencyMs: HAWKEYE_HOT_SWAP_LATENCY_MS });
    const msg = err instanceof Error ? err.message : String(err);
    const is429 =
      (err as { status?: number })?.status === 429 ||
      /rate limit|429|too many requests|timeout/i.test(msg);
    if (is429) {
      const fallbackModel = geminiFallbackModel ?? GEMINI_MACRO_FALLBACK_MODEL;
      console.warn(
        '[ConsensusEngine] Groq Rate Limit hit. Falling back to Gemini for Macro Expert...',
        { groqModel: GROQ_MODEL, fallbackModel }
      );
      try {
        const out = await callGeminiJson<ExpertMacroOutput>(
          userPrompt,
          ['macro_score', 'macro_logic'],
          fallbackModel,
          timeoutMs,
          { symbol, expert: 'Macro (Gemini Fallback)' }
        );
        const macro_score = Math.max(0, Math.min(100, Number(out.macro_score) ?? 50));
        return {
          macro_score,
          macro_logic: String(out.macro_logic || 'ניתוח מקרו (Gemini גיבוי לאחר 429 מ־Groq).').slice(0, 500),
        };
      } catch (geminiErr) {
        console.error('[ConsensusEngine] Gemini Macro fallback also failed:', geminiErr);
        return {
          macro_score: FALLBACK_EXPERT_SCORE,
          macro_logic: `${NEUTRAL_FALLBACK_LOGIC} (מקרו: Groq וגיבוי Gemini נכשלו).`,
        };
      }
    }
    console.error('[ConsensusEngine] Groq Macro agent failed:', msg);
    return {
      macro_score: FALLBACK_EXPERT_SCORE,
      macro_logic: `${NEUTRAL_FALLBACK_LOGIC} (מקרו/Groq: ${msg.slice(0, 120)}).`,
    };
  }
}

/**
 * Fetches on-chain signals: Whale movements and Exchange Inflow/Outflow.
 * Exchange Inflow = coins moving TO exchanges (potential sell pressure).
 * Exchange Outflow = coins moving FROM exchanges (holding/cold storage — often bullish).
 * Uses live Binance spot/futures JSON proxies (volume + open interest flows).
 */
export async function fetchOnChainData(symbol: string): Promise<{
  whaleMovements: string;
  exchangeInflowsOutflows: string;
}> {
  const cleanSymbol = normalizeSymbol(symbol);
  const spotBase = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const futuresBase = 'https://fapi.binance.com';
  const ticker24hUrl = `${spotBase.replace(/\/$/, '')}/api/v3/ticker/24hr?symbol=${encodeURIComponent(cleanSymbol)}`;
  const oiNowUrl = `${futuresBase}/fapi/v1/openInterest?symbol=${encodeURIComponent(cleanSymbol)}`;
  const oiHistUrl = `${futuresBase}/futures/data/openInterestHist?symbol=${encodeURIComponent(cleanSymbol)}&period=1h&limit=12`;

  try {
    const [tickerRes, oiNowRes, oiHistRes] = await Promise.all([
      fetchWithBackoff(ticker24hUrl, { timeoutMs: APP_CONFIG.fetchTimeoutMs, maxRetries: 2, cache: 'no-store' }),
      fetchWithBackoff(oiNowUrl, { timeoutMs: APP_CONFIG.fetchTimeoutMs, maxRetries: 2, cache: 'no-store' }),
      fetchWithBackoff(oiHistUrl, { timeoutMs: APP_CONFIG.fetchTimeoutMs, maxRetries: 2, cache: 'no-store' }),
    ]);

    const tickerJson = tickerRes.ok ? (await tickerRes.json()) as { quoteVolume?: string; priceChangePercent?: string; volume?: string } : {};
    const oiNowJson = oiNowRes.ok ? (await oiNowRes.json()) as { openInterest?: string; time?: number } : {};
    const oiHistJson = oiHistRes.ok
      ? (await oiHistRes.json()) as Array<{ sumOpenInterest?: string; timestamp?: number }>
      : [];

    const quoteVolumeUsd = Number.parseFloat(String(tickerJson.quoteVolume ?? '0')) || 0;
    const volumeBase = Number.parseFloat(String(tickerJson.volume ?? '0')) || 0;
    const priceChangePercent = Number.parseFloat(String(tickerJson.priceChangePercent ?? '0')) || 0;
    const openInterestNow = Number.parseFloat(String(oiNowJson.openInterest ?? '0')) || 0;

    const oiPoints = Array.isArray(oiHistJson)
      ? oiHistJson
        .map((row) => Number.parseFloat(String(row.sumOpenInterest ?? '0')) || 0)
        .filter((v) => Number.isFinite(v) && v > 0)
      : [];
    const oiStart = oiPoints.length > 1 ? oiPoints[0]! : openInterestNow;
    const oiDeltaPct = oiStart > 0 ? ((openInterestNow - oiStart) / oiStart) * 100 : 0;
    const flowLabel =
      oiDeltaPct > 2
        ? 'Participation increasing (possible aggressive positioning)'
        : oiDeltaPct < -2
          ? 'Participation decreasing (possible unwinds/liquidations)'
          : 'Participation stable';

    return {
      whaleMovements:
        `Live Binance JSON proxy (${cleanSymbol}): quoteVolume24h=${quoteVolumeUsd.toFixed(2)} USD, baseVolume24h=${volumeBase.toFixed(2)}, priceChange24h=${priceChangePercent.toFixed(2)}%. ` +
        `Large-volume regime is ${quoteVolumeUsd >= 50_000_000 ? 'active' : 'moderate'} based on current 24h turnover.`,
      exchangeInflowsOutflows:
        `Live Binance Futures JSON proxy (${cleanSymbol}): openInterestNow=${openInterestNow.toFixed(2)}, OI change (last ~12h)=${oiDeltaPct.toFixed(2)}%. ` +
        `Flow interpretation: ${flowLabel}.`,
    };
  } catch {
    return {
      whaleMovements: `Live Binance JSON unavailable for ${cleanSymbol}; on-chain proxy metrics could not be fetched this cycle.`,
      exchangeInflowsOutflows: `Live Binance Futures JSON unavailable for ${cleanSymbol}; OI flow proxy could not be fetched this cycle.`,
    };
  }
}

/**
 * Expert 5: The On-Chain Sleuth — Exchange Inflow/Outflow, Whales' Smart Money movements.
 */
async function runExpertOnChain(
  input: ConsensusEngineInput,
  model: string,
  timeoutMs: number
): Promise<ExpertOnChainOutput> {
  const onChainData = await fetchOnChainData(input.symbol);
  const institutional = input.institutional_whale_context ?? 'לא צוין';
  const prompt = `You are the On-Chain Expert in a hedge-fund grade MoE. Domain: Exchange Inflow/Outflow and Whales' Smart Money movements. Output in professional Hebrew; no generic chatbot language.

Input: Symbol ${input.symbol}, price ${input.current_price}.
On-chain (live external JSON proxies): Whale movements — ${onChainData.whaleMovements}. Exchange Inflows/Outflows — ${onChainData.exchangeInflowsOutflows}.
Leviathan institutional feed (CryptoQuant + CoinMarketCap): ${institutional}
${input.deep_memory_context}

Mandate: (1) Exchange Inflow/Outflow — Exchange Inflow = coins moving TO exchanges (potential sell pressure); Exchange Outflow = coins moving FROM exchanges (cold storage / accumulation, often bullish). Net outflow = accumulation signal; net inflow = distribution risk. (2) Whales' Smart Money — large holders accumulating (buying into weakness, moving to cold) vs distributing (sending to exchanges); cluster moves and timing relative to price. (3) Combine: outflow + whale accumulation = bullish; inflow + whale distribution = bearish. (4) If onchain_metric_shift is provided, integrate it.
Output: onchain_score (0-100) and onchain_logic (Hebrew, concise: inflow/outflow verdict, smart money read). JSON only: onchain_score, onchain_logic.`;
  const out = await callGeminiJson<ExpertOnChainOutput>(
    prompt,
    ['onchain_score', 'onchain_logic'],
    model,
    timeoutMs,
    { symbol: input.symbol, expert: 'On-Chain' }
  );
  const onchain_score = Math.max(0, Math.min(100, Number(out.onchain_score) ?? 50));
  return { onchain_score, onchain_logic: String(out.onchain_logic || 'ללא נימוק').slice(0, 500) };
}

/**
 * Expert 6: Deep Memory & Fundamental Tokenomics — Standalone Expert Verdict from similar historical trades.
 * Queries Pinecone for similar trades and produces: "Based on N similar historical trades, the probability of success is X%."
 * Focus: Tokenomics (FDV מול Market Cap), לוחות וסטינג של VC/צוות ומודלי הכנסות פרוטוקול כפי שעולים מפוסט-מורטמים היסטוריים.
 */
async function runExpertDeepMemory(
  input: ConsensusEngineInput,
  model: string,
  timeoutMs: number
): Promise<ExpertDeepMemoryOutput> {
  const normalized = normalizeSymbol(input.symbol);
  const fundamentalMetrics = await fetchFundamentalMetrics(normalized);
  let similarTrades: { text: string; symbol: string; trade_id: number }[] = [];
  try {
    similarTrades = await querySimilarTrades(normalized, 3);
  } catch {
    // Pinecone timeout or error — return neutral verdict
  }
  const count = similarTrades.length;
  const contextBlock =
    count > 0
      ? similarTrades.map((h) => h.text).join('; ')
      : 'אין עסקאות דומות במאגר ה־Vector (Pinecone).';
  const prompt = `אתה Institutional Crypto Quantitative Analyst — מומחה Deep Memory & Fundamental Tokenomics (Vector DB), Expert 6 בחדר הדיונים. תפקידך: ניתוח קריפטו מוסדי על בסיס היסטוריה דומה בלבד (לא צ'אט כללי), עם דגש על טוקנומיקס (FDV מול Market Cap), לוחות וסטינג של VC/צוות ומודלי הכנסות פרוטוקול כפי שמתועדים בפוסט-מורטמים קודמים. השתמש בשפה מקצועית קריפטו-נייטיבית בעברית. הפק "Expert Verdict" עצמאי על בסיס עסקאות היסטוריות דומות.

${DEEP_MEMORY_LESSON_001}

נתונים: סמל ${input.symbol}, מחיר נוכחי ${input.current_price}.
עסקאות דומות מהעבר (מ־Pinecone/Vector DB): ${contextBlock}
Fundamental metrics (${fundamentalMetrics.status}): ${fundamentalMetrics.summary}

כללים: (1) חובה לשקלל גם fundamentals חיים: יחס FDV/Market Cap, TVL (כאשר זמין), Active Addresses (כאשר זמין), ונתוני היצע (circulating/total). (2) אם יש לפחות עסקה דומה אחת — הסק מגוף הטקסט האם היו בעיות טוקנומיקס (FDV מנופח לעומת Market Cap, לוחות וסטינג אגרסיביים, אינפלציית טוקן, מודל הכנסות חלש) או יתרונות (FDV סביר, Vesting הדרגתי, הכנסות פרוטוקול יציבות); תרגם זאת לציון סיכוי/סיכון. (3) אם בתחקירי past trades מופיעים אירועי "unlock", "VC dump" או שחיקה מתמשכת במחיר סביב unlocks — סימן ברור ליתרון/חיסרון טוקנומיקס שיש לשקלל בציון. (4) נסח deep_memory_logic בעברית במשפט אחד ברור: "על בסיס X עסקאות היסטוריות דומות + metrics פונדמנטליים חיים, הסתברות ההצלחה להערכתי Y%." (5) אם אין עסקאות דומות או שה-fundamentals לא זמינים, ציין זאת מפורשות אך אל תמציא ערכים; החזר ציון ניטרלי כשהראיות חלשות.
החזר JSON בלבד: deep_memory_score, deep_memory_logic.`;
  const out = await callGeminiJson<ExpertDeepMemoryOutput>(
    prompt,
    ['deep_memory_score', 'deep_memory_logic'],
    model,
    timeoutMs,
    { symbol: input.symbol, expert: 'Deep Memory' }
  );
  const deep_memory_score = Math.max(0, Math.min(100, Number(out.deep_memory_score) ?? 50));
  const deep_memory_logic = String(out.deep_memory_logic || 'אין מספיק נתוני Deep Memory.').slice(0, 500);
  return { deep_memory_score, deep_memory_logic };
}

function isPolarizedExpertBoard(scores: number[]): boolean {
  const valid = scores.filter((x) => Number.isFinite(x));
  if (valid.length < 6) return false;
  const strongBuy = valid.filter((s) => s >= 67).length;
  const strongSell = valid.filter((s) => s <= 38).length;
  const spread = Math.max(...valid) - Math.min(...valid);
  return strongBuy >= 2 && strongSell >= 2 && spread >= 28;
}

/**
 * Judge (Overseer/CIO): Synthesizes all 6 experts into Gem Score 0–100.
 * Dynamic per-expert weights are computed in runConsensusEngine from 30d DB hit rates; Judge receives that summary.
 */
async function runJudge(
  tech: ExpertTechnicianOutput,
  risk: ExpertRiskOutput,
  psych: ExpertPsychOutput,
  macro: ExpertMacroOutput,
  onchain: ExpertOnChainOutput,
  deepMemory: ExpertDeepMemoryOutput,
  symbol: string,
  model: string,
  timeoutMs: number,
  judgeOpts?: {
    polarizedBoard: boolean;
    expertHitRatesLine: string;
  }
): Promise<{ master_insight_he: string; reasoning_path: string; debate_resolution: string }> {
  const expertWeights = await getExpertWeights();
  const polarized = judgeOpts?.polarizedBoard ?? false;
  const hitLine = judgeOpts?.expertHitRatesLine ?? '';
  const debateBlock = polarized
    ? `POLARIZED_BOARD=true: שני מחנות מנוגדים (BUY חזק מול SELL חזק). חובה למלא debate_resolution בעברית: סיכום דיון — מה כל צד רואה, איזה ראיות דוחקות, ומה נתיב ההכרעה הסופית לפני ציון ביטחון.`
    : `POLARIZED_BOARD=false: השאר debate_resolution כמחרוזת ריקה "".`;

  const prompt = `אתה Chief Investment Officer סקפטי (Supreme Inspector, Overseer/CIO) בחדר הדיונים — Institutional Crypto Quantitative Board. חובה: לסנתז (synthesize) ולהצליב (cross-reference) במפורש את כל ששת התשובות לפני קביעת התובנה הסופית, ולחפש קונפליקטים מובהקים בין מומחים. אין לתת תובנה בלי להתייחס להסכמה או סתירה בין מומחים או בלי להתייחס ל־Deep Memory (Pinecone).

${debateBlock}

מצב אמון מומחים דינמי (Reinforcement Learning): Data Expert=${expertWeights.dataExpertWeight.toFixed(2)}, News Expert=${expertWeights.newsExpertWeight.toFixed(2)}, Macro Expert=${expertWeights.macroExpertWeight.toFixed(2)}. משקלים אלה משקפים ביצועים אחרונים של המומחים — כאשר המשקל גבוה יותר תן משקל גדול יותר לעמדת המומחה, וכאשר המשקל נמוך היה ספקן יותר.
${hitLine ? `שיעורי פגיעה אמפיריים (30 יום, DB פוסט-מורטם): ${hitLine}` : ''}

ששת המומחים הגישו (הקשר קריפטו מוסדי — לא צ'אט כללי):
- 1.Technician (Entry Zones, OI, Funding, Liquidity Sweeps): ציון ${tech.tech_score}, לוגיקה: ${tech.tech_logic}
- 2.Risk & MM Manager (Volatility, Kelly Position Sizing, Drawdown): ציון ${risk.risk_score}, לוגיקה: ${risk.risk_logic}
- 3.Sentiment & Perps (Funding, Liquidations, Social): ציון ${psych.psych_score}, לוגיקה: ${psych.psych_logic}
- 4.Macro & Order Book (ETF, DXY, Walls): ציון ${macro.macro_score}, לוגיקה: ${macro.macro_logic}
- 5.On-Chain Sleuth (Whale, Exchange Inflow/Outflow): ציון ${onchain.onchain_score}, לוגיקה: ${onchain.onchain_logic}
- 6.Deep Memory & Tokenomics (Vector — similar historical trades, FDV/MCap, Vesting, Protocol revenue models): ציון ${deepMemory.deep_memory_score}, לוגיקה: ${deepMemory.deep_memory_logic}

תפקידך: (1) סינתזה רב-סוכנית סקפטית: הצלב במפורש טכני מול מקרו (setup טכני מול רוח מקרו), Order Book מול סנטימנט (Psych), On-Chain מול Psych (זרימות מול sentiment), ורכיב Deep Memory & Tokenomics מול כל שאר המומחים — אם היסטוריית Pinecone מצביעה על דפוסי כשל חוזרים (למשל vesting unlock dumps או שחיקת מחיר עקבית), עליך להוריד את רמת הביטחון גם אם יתר המומחים חיוביים. (2) הדגש בקבלת החלטה סופית מצבים של "קונפליקט חמור" (למשל Risk/MM פסימי ו-Deep Memory שלילי בזמן שסנטימנט הייפי) והעדף שמרנות. (3) Gem Score מחושב במערכת לפי משקלים דינמיים — אל תחשב בעצמך. (4) נסח master_insight_he בעברית מקצועית קריפטו: מקסימום 2 משפטים קצרים והחלטיים — קונצנזוס והמלצה לסמל ${symbol} בהתבסס על הסינתזה בלבד, כולל אם CIO מחליט "No-go" למרות ציון גולמי גבוה בגלל דפוסי עבר מ-Pinecone. (5) reasoning_path: משפט אחד — איך הצלבת וסינתזת את ששת המומחים. (6) debate_resolution: כאשר POLARIZED_BOARD=true — נתיב הכרעה לאחר דיון בין מחנות מנוגדים; כאשר false — "" בלבד.
חובה: החזר רק אובייקט JSON גולמי עם השדות בדיוק: master_insight_he, reasoning_path, debate_resolution. אסור markdown, אסור טקסט מקדים — JSON תקף בלבד.`;
  const out = await callGeminiJson<{ master_insight_he: string; reasoning_path: string; debate_resolution?: string }>(
    prompt,
    ['master_insight_he', 'reasoning_path', 'debate_resolution'],
    model,
    timeoutMs,
    { symbol, expert: 'Judge' }
  );
  return {
    master_insight_he: String(out.master_insight_he || 'אין תובנה').slice(0, 600),
    reasoning_path: String(out.reasoning_path || '').slice(0, 320),
    debate_resolution: String(out.debate_resolution ?? '').slice(0, 500),
  };
}

/** Fallback score when an expert times out or fails (Gemini API error). */
const FALLBACK_EXPERT_SCORE = 50;

/**
 * Runs the full MoE + Debate Room pipeline — 6-Agent Board.
 * 1) Fetches Deep Memory context (last 3 trades + Vector DB).
 * 2) Runs 6 experts in parallel: Tech, Risk, Psych (Gemini), Macro (Groq), On-Chain, Deep Memory (Gemini). Promise.allSettled — failure uses fallback score 50.
 * 3) Overseer (Judge) synthesizes all 6 into master_insight_he.
 * 4) Final_Confidence uses baseline 1/6 per expert (~16.67% each) with optional On-Chain +20% boost when Deep Memory
 *    historical accuracy passes threshold; weights are re-normalized across available experts.
 *    Uses options.moeConfidenceThreshold or getAppSettings() or CONSENSUS_THRESHOLD.
 */
export async function runConsensusEngine(
  input: Omit<ConsensusEngineInput, 'deep_memory_context'>,
  options?: {
    model?: string;
    timeoutMs?: number;
    moeConfidenceThreshold?: number;
    /** When set, skip calling Groq for Macro Expert and use this summary (scanner pre-fetch). */
    precomputedMacro?: ExpertMacroOutput;
    /** When set, skip duplicate getAppSettings() (caller already loaded settings — e.g. analysis-core). */
    cachedAppSettings?: AppSettings;
    /** Local QA mode: bypass all live experts and use deterministic board payload. */
    mockPayload?: ConsensusMockPayload;
  }
): Promise<ConsensusResult> {
  const requestedRaw = options?.model ?? APP_CONFIG.primaryModel ?? GEMINI_DEFAULT_FLASH_MODEL_ID;
  const isGeminiLike =
    /gemini/i.test(String(requestedRaw)) || String(requestedRaw).startsWith('models/gemini');
  const model = isGeminiLike
    ? resolveGeminiModel(requestedRaw).model.replace(/^models\//, '')
    : SAFE_GEMINI_FALLBACK_MODEL;
  if (!isGeminiLike) {
    console.warn(
      `[ConsensusEngine] Non-Gemini model "${requestedRaw}" cannot run Gemini experts. Using "${model}" and continuing with Groq + Gemini providers.`
    );
  }
  const rawTimeout = options?.timeoutMs ?? Math.min(60_000, APP_CONFIG.geminiTimeoutMs ?? 60_000);
  /** Bounded so parallel experts can finish before the global failsafe (was min 45s × parallel vs 45s wall → false timeouts). */
  const timeoutMs = Math.min(58_000, Math.max(22_000, Number.isFinite(rawTimeout) ? rawTimeout : 45_000));
  const consensusFailsafeMs = Math.max(ABSOLUTE_FAILSAFE_TIMEOUT_MS, timeoutMs + 42_000);
  let threshold = options?.moeConfidenceThreshold;
  let riskToleranceLevel: 'strict' | 'moderate' | 'aggressive' | undefined;
  let bestExpertFromDeepMemory: { bestExpertKey: string; accuracyPct: number } | null = null;
  try {
    const settings = options?.cachedAppSettings ?? (await getAppSettings());
    // Use DB-backed Overseer settings (saved from Supreme Inspector panel)
    if (threshold == null) threshold = settings.neural?.moeConfidenceThreshold ?? CONSENSUS_THRESHOLD;
    riskToleranceLevel = settings.risk?.riskToleranceLevel;
    // Dynamic expert weighting: if this symbol's best expert (from last backtest) is onchain with high accuracy, boost its weight
    const normalized = normalizeSymbol(input.symbol);
    const stored = settings.neural?.bestExpertBySymbol?.[normalized];
    if (stored?.bestExpertKey && Number.isFinite(stored.accuracyPct)) {
      bestExpertFromDeepMemory = { bestExpertKey: stored.bestExpertKey, accuracyPct: stored.accuracyPct };
    } else if (normalized === 'BTCUSDT') {
      // Post-mortem fallback: BTC backtest (March 2026) showed onchain at 71.9% — use as default until next backtest persists
      bestExpertFromDeepMemory = { bestExpertKey: 'onchain', accuracyPct: 71.9 };
    }
  } catch {
    if (threshold == null) threshold = CONSENSUS_THRESHOLD;
  }

  if (options?.mockPayload) {
    const cohesion = await evaluateSystemCohesionAsync({
      tech_score: options.mockPayload.tech.tech_score,
      risk_score: options.mockPayload.risk.risk_score,
      psych_score: options.mockPayload.psych.psych_score,
    });
    const effectiveThreshold = cohesion.marketUncertainty ? cohesion.suggestedMoeThreshold : threshold;
    const final_confidence =
      options.mockPayload.tech.tech_score * WEIGHT_TECH +
      options.mockPayload.risk.risk_score * WEIGHT_RISK +
      options.mockPayload.psych.psych_score * WEIGHT_PSYCH +
      options.mockPayload.macro.macro_score * WEIGHT_MACRO +
      options.mockPayload.onchain.onchain_score * WEIGHT_ONCHAIN +
      options.mockPayload.deepMemory.deep_memory_score * WEIGHT_DEEP_MEMORY;
    return {
      tech_score: options.mockPayload.tech.tech_score,
      risk_score: options.mockPayload.risk.risk_score,
      psych_score: options.mockPayload.psych.psych_score,
      macro_score: options.mockPayload.macro.macro_score,
      onchain_score: options.mockPayload.onchain.onchain_score,
      deep_memory_score: options.mockPayload.deepMemory.deep_memory_score,
      tech_logic: options.mockPayload.tech.tech_logic,
      risk_logic: options.mockPayload.risk.risk_logic,
      psych_logic: options.mockPayload.psych.psych_logic,
      macro_logic: options.mockPayload.macro.macro_logic,
      onchain_logic: options.mockPayload.onchain.onchain_logic,
      deep_memory_logic: options.mockPayload.deepMemory.deep_memory_logic,
      master_insight_he: options.mockPayload.judge.master_insight_he,
      reasoning_path: options.mockPayload.judge.reasoning_path,
      final_confidence: Math.round(final_confidence * 10) / 10,
      consensus_approved: final_confidence >= effectiveThreshold,
      debate_resolution: '',
    };
  }

  const [deep_memory_context, twitterSentiment] = await Promise.all([
    getDeepMemoryContext(input.symbol),
    fetchTwitterSentiment(input.symbol).catch(() => ({ summary: '', tweets: [] })),
  ]);
  const fullInput: ConsensusEngineInput = {
    ...input,
    deep_memory_context,
    twitter_realtime_tweets: twitterSentiment.summary ? twitterSentiment.summary : null,
  };
  settleAndRecordShadow(input.symbol, input.current_price);
  const marketRegime = detectMarketRegime(input);

  // Deep Execution: stagger expert calls to reduce concurrent load on providers.
  const expertsPromise = (async () => {
    const techPromise = settleNow(runExpertTechnician(fullInput, model, timeoutMs));
    await sleep(300);
    const riskPromise = settleNow(runExpertRisk(fullInput, model, timeoutMs, riskToleranceLevel));
    await sleep(300);
    const psychPromise = settleNow(runExpertPsych(fullInput, model, timeoutMs));
    await sleep(300);
    const macroPromise = options?.precomputedMacro != null
      ? settleNow(Promise.resolve(options.precomputedMacro))
      : settleNow(runExpertMacro(input.symbol, fullInput, timeoutMs, model));
    await sleep(300);
    const onchainPromise = settleNow(runExpertOnChain(fullInput, model, timeoutMs));
    await sleep(300);
    const deepMemoryPromise = settleNow(runExpertDeepMemory(fullInput, model, timeoutMs));

    return Promise.all([
      techPromise,
      riskPromise,
      psychPromise,
      macroPromise,
      onchainPromise,
      deepMemoryPromise,
    ]);
  })();

  let techSettled: PromiseSettledResult<ExpertTechnicianOutput>;
  let riskSettled: PromiseSettledResult<ExpertRiskOutput>;
  let psychSettled: PromiseSettledResult<ExpertPsychOutput>;
  let macroSettled: PromiseSettledResult<ExpertMacroOutput>;
  let onchainSettled: PromiseSettledResult<ExpertOnChainOutput>;
  let deepMemorySettled: PromiseSettledResult<ExpertDeepMemoryOutput>;
  try {
    [
      techSettled,
      riskSettled,
      psychSettled,
      macroSettled,
      onchainSettled,
      deepMemorySettled,
    ] = await Promise.race([
      expertsPromise,
      new Promise<never>((_, rej) =>
        setTimeout(
          () => rej(new Error('Consensus absolute timeout (APIs unresponsive)')),
          consensusFailsafeMs
        )
      ),
    ]);
  } catch (absErr) {
    const msg = absErr instanceof Error ? absErr.message : String(absErr);
    if (!msg.includes('Consensus absolute timeout')) throw absErr;
    console.warn('[ConsensusEngine] Absolute failsafe fired — using neutral board fallbacks.', msg);
    const reason = absErr;
    techSettled = { status: 'rejected', reason };
    riskSettled = { status: 'rejected', reason };
    psychSettled = { status: 'rejected', reason };
    macroSettled = { status: 'rejected', reason };
    onchainSettled = { status: 'rejected', reason };
    deepMemorySettled = { status: 'rejected', reason };
  }

  const expert1: ExpertTechnicianOutput =
    techSettled.status === 'fulfilled'
      ? techSettled.value
      : { tech_score: FALLBACK_EXPERT_SCORE, tech_logic: 'מומחה טכני לא זמין (timeout/שגיאה).' };
  const expert2: ExpertRiskOutput =
    riskSettled.status === 'fulfilled'
      ? riskSettled.value
      : { risk_score: FALLBACK_EXPERT_SCORE, risk_logic: 'מנהל סיכונים לא זמין (timeout/שגיאה).' };
  const expert3: ExpertPsychOutput =
    psychSettled.status === 'fulfilled'
      ? psychSettled.value
      : { psych_score: FALLBACK_EXPERT_SCORE, psych_logic: 'פסיכולוג שוק לא זמין (timeout/שגיאה).' };

  const techFailed = techSettled.status !== 'fulfilled';
  const riskFailed = riskSettled.status !== 'fulfilled';
  const psychFailed = psychSettled.status !== 'fulfilled';
  const macroFailed = macroSettled.status !== 'fulfilled';
  const expert4: ExpertMacroOutput =
    macroSettled.status === 'fulfilled'
      ? macroSettled.value
      : {
          macro_score: FALLBACK_EXPERT_SCORE,
          macro_logic: 'מומחה מקרו/Order Book לא זמין (Groq timeout/שגיאה/מפתח חסר).',
        };

  const onchainFailed = onchainSettled.status !== 'fulfilled';
  const expert5: ExpertOnChainOutput =
    onchainSettled.status === 'fulfilled'
      ? onchainSettled.value
      : {
          onchain_score: FALLBACK_EXPERT_SCORE,
          onchain_logic: NEUTRAL_FALLBACK_LOGIC,
        };

  const deepMemoryFailed = deepMemorySettled.status !== 'fulfilled';
  const expert6: ExpertDeepMemoryOutput =
    deepMemorySettled.status === 'fulfilled'
      ? deepMemorySettled.value
      : {
          deep_memory_score: FALLBACK_EXPERT_SCORE,
          deep_memory_logic: NEUTRAL_FALLBACK_LOGIC,
        };

  const logModel = model ?? 'MODEL_NAME_ERROR';
  if (techSettled.status === 'rejected') {
    console.warn('[ConsensusEngine] Technician expert failed:', techSettled.reason, '| model:', logModel);
  }
  if (riskSettled.status === 'rejected') {
    console.warn('[ConsensusEngine] Risk expert failed:', riskSettled.reason, '| model:', logModel);
  }
  if (psychSettled.status === 'rejected') {
    console.warn('[ConsensusEngine] Psych expert failed:', psychSettled.reason, '| model:', logModel);
  }
  if (macroSettled.status === 'rejected') {
    console.warn('[ConsensusEngine] Macro expert failed:', macroSettled.reason);
  }
  if (onchainSettled.status === 'rejected') {
    console.warn('[ConsensusEngine] On-Chain Sleuth expert failed:', onchainSettled.reason);
  }
  if (deepMemorySettled.status === 'rejected') {
    console.warn('[ConsensusEngine] Deep Memory expert failed:', deepMemorySettled.reason);
  }

  const cohesion = await evaluateSystemCohesionAsync({
    tech_score: expert1.tech_score,
    risk_score: expert2.risk_score,
    psych_score: expert3.psych_score,
  });
  const effectiveThreshold = cohesion.marketUncertainty ? cohesion.suggestedMoeThreshold : threshold;

  const normalizedForHits = normalizeSymbol(input.symbol);
  let hitRates = await getExpertHitRates30d({ symbol: normalizedForHits }).catch(() => ({
    technician: 50,
    risk: 50,
    psych: 50,
    macro: 50,
    onchain: 50,
    deepMemory: 50,
  }));
  const bestKey = bestExpertFromDeepMemory?.bestExpertKey;
  const bestAcc = bestExpertFromDeepMemory?.accuracyPct;
  if (bestKey && typeof bestAcc === 'number' && Number.isFinite(bestAcc)) {
    const map: Record<string, keyof typeof hitRates> = {
      technician: 'technician',
      risk: 'risk',
      psych: 'psych',
      macro: 'macro',
      onchain: 'onchain',
      deepMemory: 'deepMemory',
    };
    const slot = map[bestKey];
    if (slot) hitRates = { ...hitRates, [slot]: Math.max(hitRates[slot], bestAcc) };
  }

  const expertScoresForPolar = [
    expert1.tech_score,
    expert2.risk_score,
    expert3.psych_score,
    expert4.macro_score,
    expert5.onchain_score,
    expert6.deep_memory_score,
  ];
  const polarizedBoard = isPolarizedExpertBoard(expertScoresForPolar);
  const expertHitRatesLine = `טכני=${hitRates.technician}%, סיכון=${hitRates.risk}%, פסיכ=${hitRates.psych}%, מקרו=${hitRates.macro}%, on-chain=${hitRates.onchain}%, DeepMemory=${hitRates.deepMemory}%.`;

  let judgeResult: { master_insight_he: string; reasoning_path: string; debate_resolution: string };
  try {
    judgeResult = await runJudge(
      expert1,
      expert2,
      expert3,
      expert4,
      expert5,
      expert6,
      input.symbol,
      model,
      timeoutMs,
      { polarizedBoard, expertHitRatesLine }
    );
  } catch (judgeErr) {
    const judgeMsg = judgeErr instanceof Error ? judgeErr.message : String(judgeErr);
    console.warn('[ConsensusEngine] Judge (Overseer) failed, using fallback insight:', judgeMsg);
    judgeResult = {
      master_insight_he: 'תובנת קונצנזוס לא זמינה (שגיאה בשופט). המערכת משתמשת בציוני ששת המומחים בלבד.',
      reasoning_path: 'שופט לא זמין — חישוב ציון סופי לפי משקלים בלבד.',
      debate_resolution: '',
    };
  }

  const hitToWeight = (pct: number) => {
    const x = Math.max(0.38, Math.min(0.92, pct / 100));
    return x ** 1.35;
  };
  const regimeBase: Record<BoardExpertKey, number> =
    marketRegime === 'high-volatility'
      ? { technician: 0.95, risk: 1.4, psych: 1.05, macro: 0.9, onchain: 1.15, deepMemory: 0.9 }
      : marketRegime === 'trending'
        ? { technician: 1.25, risk: 0.85, psych: 1.0, macro: 1.15, onchain: 1.1, deepMemory: 0.95 }
        : { technician: 1.0, risk: 1.05, psych: 1.1, macro: 1.1, onchain: 0.95, deepMemory: 1.0 };

  const watchdog = {
    gemini: getProviderHealth('gemini'),
    groq: getProviderHealth('groq'),
  };
  const providerHealthFactor = (provider: ModelProvider): number => {
    const status = provider === 'gemini' ? watchdog.gemini.status : watchdog.groq.status;
    if (status === 'unstable') return 0;
    if (status === 'degraded') return 0.65;
    return 1;
  };

  const weightByExpert: Record<BoardExpertKey, number> = {
    technician: hitToWeight(hitRates.technician) * regimeBase.technician * (1 + shadowReliabilityBoost('technician')) * providerHealthFactor('gemini'),
    risk: hitToWeight(hitRates.risk) * regimeBase.risk * (1 + shadowReliabilityBoost('risk')) * providerHealthFactor('gemini'),
    psych: hitToWeight(hitRates.psych) * regimeBase.psych * (1 + shadowReliabilityBoost('psych')) * providerHealthFactor('gemini'),
    macro: hitToWeight(hitRates.macro) * regimeBase.macro * (1 + shadowReliabilityBoost('macro')) * providerHealthFactor('groq'),
    onchain: hitToWeight(hitRates.onchain) * regimeBase.onchain * (1 + shadowReliabilityBoost('onchain')) * providerHealthFactor('gemini'),
    deepMemory: hitToWeight(hitRates.deepMemory) * regimeBase.deepMemory * (1 + shadowReliabilityBoost('deepMemory')) * providerHealthFactor('gemini'),
  };

  shadowPredictions.set(`${input.symbol}:technician`, {
    symbol: input.symbol,
    priceAtPrediction: input.current_price,
    predictedDirection: scoreToDirection(expert1.tech_score),
    confidence: expert1.tech_score,
  });
  shadowPredictions.set(`${input.symbol}:risk`, {
    symbol: input.symbol,
    priceAtPrediction: input.current_price,
    predictedDirection: scoreToDirection(expert2.risk_score),
    confidence: expert2.risk_score,
  });
  shadowPredictions.set(`${input.symbol}:psych`, {
    symbol: input.symbol,
    priceAtPrediction: input.current_price,
    predictedDirection: scoreToDirection(expert3.psych_score),
    confidence: expert3.psych_score,
  });
  shadowPredictions.set(`${input.symbol}:macro`, {
    symbol: input.symbol,
    priceAtPrediction: input.current_price,
    predictedDirection: scoreToDirection(expert4.macro_score),
    confidence: expert4.macro_score,
  });
  shadowPredictions.set(`${input.symbol}:onchain`, {
    symbol: input.symbol,
    priceAtPrediction: input.current_price,
    predictedDirection: scoreToDirection(expert5.onchain_score),
    confidence: expert5.onchain_score,
  });
  shadowPredictions.set(`${input.symbol}:deepMemory`, {
    symbol: input.symbol,
    priceAtPrediction: input.current_price,
    predictedDirection: scoreToDirection(expert6.deep_memory_score),
    confidence: expert6.deep_memory_score,
  });

  const weightedExperts = [
    { score: expert1.tech_score, weight: weightByExpert.technician, failed: techFailed },
    { score: expert2.risk_score, weight: weightByExpert.risk, failed: riskFailed },
    { score: expert3.psych_score, weight: weightByExpert.psych, failed: psychFailed },
    { score: expert4.macro_score, weight: weightByExpert.macro, failed: macroFailed },
    { score: expert5.onchain_score, weight: weightByExpert.onchain, failed: onchainFailed },
    { score: expert6.deep_memory_score, weight: weightByExpert.deepMemory, failed: deepMemoryFailed },
  ];
  const availableWeight = weightedExperts
    .filter((item) => !item.failed)
    .reduce((sum, item) => sum + item.weight, 0);
  const final_confidence =
    availableWeight > 0
      ? weightedExperts
          .filter((item) => !item.failed)
          .reduce((sum, item) => sum + item.score * item.weight, 0) / availableWeight
      : FALLBACK_EXPERT_SCORE;
  const consensus_approved = final_confidence >= effectiveThreshold;
  const votes = {
    technician: scoreToDirection(expert1.tech_score),
    risk: scoreToDirection(expert2.risk_score),
    psych: scoreToDirection(expert3.psych_score),
    macro: scoreToDirection(expert4.macro_score),
    onchain: scoreToDirection(expert5.onchain_score),
    deepMemory: scoreToDirection(expert6.deep_memory_score),
  } as const;
  const voteIds: Partial<Record<BoardExpertKey, string>> = {
    technician: buildDeterministicId('vote', [input.symbol, 'technician', input.current_price, expert1.tech_score, votes.technician]),
    risk: buildDeterministicId('vote', [input.symbol, 'risk', input.current_price, expert2.risk_score, votes.risk]),
    psych: buildDeterministicId('vote', [input.symbol, 'psych', input.current_price, expert3.psych_score, votes.psych]),
    macro: buildDeterministicId('vote', [input.symbol, 'macro', input.current_price, expert4.macro_score, votes.macro]),
    onchain: buildDeterministicId('vote', [input.symbol, 'onchain', input.current_price, expert5.onchain_score, votes.onchain]),
    deepMemory: buildDeterministicId('vote', [input.symbol, 'deepMemory', input.current_price, expert6.deep_memory_score, votes.deepMemory]),
  };
  const decisionId = buildDeterministicId('decision', [
    input.symbol,
    input.current_price,
    expert1.tech_score,
    expert2.risk_score,
    expert3.psych_score,
    expert4.macro_score,
    expert5.onchain_score,
    expert6.deep_memory_score,
    Math.round(final_confidence * 10),
  ]);
  const rawWeightSum = Object.values(weightByExpert).reduce((sum, w) => sum + Math.max(0, w), 0);
  const activeBoardWeights: Partial<Record<BoardExpertKey, number>> = rawWeightSum > 0
    ? {
        technician: Math.round((Math.max(0, weightByExpert.technician) / rawWeightSum) * 1000) / 10,
        risk: Math.round((Math.max(0, weightByExpert.risk) / rawWeightSum) * 1000) / 10,
        psych: Math.round((Math.max(0, weightByExpert.psych) / rawWeightSum) * 1000) / 10,
        macro: Math.round((Math.max(0, weightByExpert.macro) / rawWeightSum) * 1000) / 10,
        onchain: Math.round((Math.max(0, weightByExpert.onchain) / rawWeightSum) * 1000) / 10,
        deepMemory: Math.round((Math.max(0, weightByExpert.deepMemory) / rawWeightSum) * 1000) / 10,
      }
    : {};

  return {
    tech_score: expert1.tech_score,
    risk_score: expert2.risk_score,
    psych_score: expert3.psych_score,
    macro_score: expert4.macro_score,
    onchain_score: expert5.onchain_score,
    deep_memory_score: expert6.deep_memory_score,
    tech_logic: expert1.tech_logic,
    risk_logic: expert2.risk_logic,
    psych_logic: expert3.psych_logic,
    macro_logic: expert4.macro_logic,
    onchain_logic: expert5.onchain_logic,
    deep_memory_logic: expert6.deep_memory_logic,
    ...((macroFailed ||
      /\(מקרו\/Groq|מקרו: Groq וגיבוי/.test(expert4.macro_logic)) && { macro_fallback_used: true }),
    ...(onchainFailed && { onchain_fallback_used: true }),
    ...(deepMemoryFailed && { deep_memory_fallback_used: true }),
    master_insight_he: judgeResult.master_insight_he,
    reasoning_path: judgeResult.reasoning_path,
    final_confidence: Math.round(final_confidence * 10) / 10,
    consensus_approved,
    decision_id: decisionId,
    vote_ids: voteIds,
    market_regime: marketRegime,
    active_board_weights: activeBoardWeights,
    model_watchdog: watchdog,
    ...(judgeResult.debate_resolution?.trim()
      ? { debate_resolution: judgeResult.debate_resolution.trim() }
      : {}),
  };
}
