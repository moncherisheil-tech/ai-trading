/**
 * Core AI analysis logic: Binance + F&G + Sentiment + Gemini → PredictionRecord.
 * Institutional-grade Quantitative AI engine: rich payload, Quant persona, feedback loop.
 * Shared by UI (actions) and the live scanning worker.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDbAsync, saveDbAsync, type PredictionRecord, type SourceCitation } from '@/lib/db';
import { getGeminiApiKey } from '@/lib/env';
import { APP_CONFIG } from '@/lib/config';
import { aiPredictionSchema, aiPredictionPartialSchema, binanceKlinesSchema, fearGreedSchema, sourceCitationSchema, type RiskLevel } from '@/lib/schemas';
import { listStrategyInsights } from '@/lib/db/strategy-repository';
import { getHistoricalBySymbol } from '@/lib/db/historical-predictions';
import { z } from 'zod';
import { writeAudit } from '@/lib/audit';
import { recordAuditLog } from '@/lib/db/audit-logs';
import { getMarketSentiment, checkSentimentGuardrail } from '@/lib/agents/news-agent';
import { computeRSI, getRiskLevelHe, buildHebrewReport } from '@/lib/prediction-formula';
import { sendTelegramMessage, sendGemAlert } from '@/lib/telegram';
import { fetchWithBackoff, fetchBinanceOrderBookDepth, summarizeOrderBookDepth, fetchMacroContext } from '@/lib/api-utils';
import type { BinanceKline } from '@/lib/actions-types';
import { getSuccessFailureFeedback } from '@/lib/smart-agent';
import { ema, atr } from '@/lib/indicators';
import {
  runConsensusEngine,
  computeMacdSignal,
  type ConsensusResult,
  type ExpertMacroOutput,
} from '@/lib/consensus-engine';
import { getLeviathanSnapshot } from '@/lib/leviathan';
import { storeBoardMeetingMemory } from '@/lib/vector-db';
import { getAppSettings } from '@/lib/db/app-settings';
import { executeAutonomousConsensusSignal } from '@/lib/trading/execution-engine';
import { calculatePositionSize, calculateTradeLevels } from '@/lib/trading/risk-manager';
import { getRecentWhaleMovements } from '@/lib/trading/whale-tracker';
import { getDeveloperActivity } from '@/lib/trading/github-tracker';
import { resolveGeminiModel, withGeminiRateLimitRetry } from '@/lib/gemini-model';
import {
  computeEmaSeries,
  computeBollingerSeries,
  inferMarketStructure,
  buildTechnicalContext,
} from '@/lib/quant/technical-context';
import {
  fetchOpenInterest,
  getOIEnrichmentForCandle,
  formatOISignal,
  type RawKlineRow,
} from '@/lib/quant/open-interest';
import type { Locale } from '@/lib/i18n';

/** Technical indicators fed to the Quant model. Extend with macd_signal, etc. when available. */
export interface TechnicalIndicatorsInput {
  rsi_14: number;
  volatility_pct: number;
  macd_signal?: number;
}

/** Single historical outcome for feedback loop — used to adjust future predictions. */
export interface HistoricalPredictionOutcome {
  prediction_date: string;
  predicted_direction: string;
  probability: number | null;
  target_percentage: number | null;
  outcome_label: string;
  absolute_error_pct: number;
  price_diff_pct: number;
  learning_note?: string;
}

interface AiPredictionResult {
  symbol: string;
  probability: number;
  target_percentage: number;
  direction: PredictionRecord['predicted_direction'];
  risk_level?: RiskLevel;
  logic: string;
  strategic_advice: string;
  learning_context: string;
  sources: SourceCitation[];
  tactical_opinion_he?: string;
}

type DedupEntry = {
  expiresAt: number;
  result: {
    success: true;
    data: PredictionRecord;
    chartData: BinanceKline[];
    riskManagement?: {
      suggestedPositionSize: number;
      stopLoss: number | null;
      takeProfit: number | null;
      positionRejected: boolean;
      rationale: string;
    };
  };
};

const analysisDedupCache = new Map<string, DedupEntry>();
const REFERENCE_ACCOUNT_BALANCE_USD = 10_000;
const ASSET_REPO_MAP: Record<string, string> = {
  BTC: 'bitcoin/bitcoin',
  ETH: 'ethereum/go-ethereum',
  SOL: 'solana-labs/solana',
  XRP: 'XRPLF/rippled',
  ADA: 'IntersectMBO/cardano-node',
  DOGE: 'dogecoin/dogecoin',
};

function getAssetTickerFromSymbol(symbol: string): string {
  const clean = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.endsWith('USDT') ? clean.slice(0, -4) : clean;
}

function isValidBinanceKlineRow(row: unknown): row is [number, string, string, string, string, string] {
  return (
    Array.isArray(row) &&
    row.length >= 6 &&
    typeof row[0] === 'number' &&
    typeof row[1] === 'string' &&
    typeof row[2] === 'string' &&
    typeof row[3] === 'string' &&
    typeof row[4] === 'string' &&
    typeof row[5] === 'string'
  );
}

async function withRetry<T>(work: () => Promise<T>, retries = APP_CONFIG.maxFetchRetries): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt >= retries - 1) break;
      const base = 150 * (attempt + 1);
      const jitter = Math.min(150, (attempt + 1) * 30);
      await new Promise((resolve) => setTimeout(resolve, base + jitter));
    }
  }
  throw lastError;
}

async function fetchJson<T>(url: string, cache: RequestCache = 'no-store', schema?: z.ZodType<T>): Promise<T> {
  const parsedUrl = new URL(url);
  if (!APP_CONFIG.trustedApiOrigins.includes(parsedUrl.origin)) {
    throw new Error('Untrusted upstream API endpoint.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APP_CONFIG.fetchTimeoutMs);
  try {
    const res = await withRetry(() => fetch(url, { cache, signal: controller.signal }));
    if (!res.ok) {
      const rawBody = await res.text().catch(() => '');
      const bodyPreview = rawBody.trim().slice(0, 240);
      const msg =
        res.status === 451
          ? 'Request failed (451) for upstream API.'
          : `Request failed (${res.status}) for upstream API.${bodyPreview ? ` Body: ${bodyPreview}` : ''}`;
      throw new Error(msg);
    }
    const rawBody = await res.text();
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch (parseErr) {
      const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      const preview = rawBody.trim().slice(0, 240);
      console.error('[analysis-core] Upstream API returned non-JSON payload', {
        url,
        parseError: parseMsg,
        rawPreview: preview,
      });
      throw new Error(`Upstream API returned invalid JSON. ${preview ? `Raw: ${preview}` : 'Empty body.'}`);
    }
    return schema ? schema.parse(payload) : (payload as T);
  } finally {
    clearTimeout(timeout);
  }
}

function logZodError(err: z.ZodError): void {
  for (const issue of err.errors) {
    const pathStr = issue.path.length ? issue.path.join('.') : '(root)';
    console.error(`[Zod] path=${pathStr} message=${issue.message}`);
  }
}

/** Wraps a Gemini request in a timeout to avoid hanging the server. */
function withGeminiTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Gemini request timeout')), ms)
    ),
  ]);
}

/** Detect Google API 429 / RESOURCE_EXHAUSTED (quota or rate limit). */
function isQuotaExhaustedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: number }).code : undefined;
  const status = err && typeof err === 'object' && 'status' in err ? (err as { status?: number }).status : undefined;
  return (
    code === 429 ||
    status === 429 ||
    /429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)
  );
}

/** Detect Google API 404 (model not found) or 500 (server error) for graceful degradation. */
function is404Or500Error(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: number }).code : undefined;
  const status = err && typeof err === 'object' && 'status' in err ? (err as { status?: number }).status : undefined;
  return (
    code === 404 ||
    code === 500 ||
    status === 404 ||
    status === 500 ||
    /404|500|not found|NOT_FOUND|internal error/i.test(msg)
  );
}

/** Extract JSON string from model text (handles markdown fences and trailing text). Returns empty string if no '{' found. */
function extractJsonFromText(text: string): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  let str = trimmed;
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*\n?/i, '').replace(/(?:\r?\n)?\s*```\s*$/, '').trim();
  }
  const start = str.indexOf('{');
  if (start < 0) return '';
  const end = str.lastIndexOf('}') + 1;
  if (end > start) return str.slice(start, end);
  const match = str.match(/\{[\s\S]*\}/);
  return match ? match[0]! : '';
}

/** Parse JSON with fallback: extract blob first, then parse. Bulletproof against empty string and partial JSON. */
function parseJsonWithFallback<T = unknown>(raw: string): T {
  const jsonStr = extractJsonFromText(raw ?? '');
  if (!jsonStr || !jsonStr.trim()) {
    const preview = (raw ?? '').trim().slice(0, 280);
    throw new Error(`No valid JSON object in AI response.${preview ? ` Raw: ${preview}` : ''}`);
  }
  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const preview = (raw ?? '').trim().slice(0, 280);
    throw new Error(`JSON parse failed after extracting blob (length ${jsonStr.length}): ${msg}.${preview ? ` Raw: ${preview}` : ''}`);
  }
}

function getGroqApiKeyFromEnvWithLog(scope: string): string | undefined {
  const envVarName = 'GROQ_API_KEY';
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    console.error(`[${scope}] Missing Groq API key; attempted env var: ${envVarName}`);
    return undefined;
  }
  return key;
}

function getGeminiApiKeyFromEnvWithTrim(scope: string): string {
  const envVarName = 'GEMINI_API_KEY';
  const key = getGeminiApiKey().trim();
  if (!key) {
    console.error(`[${scope}] Missing Gemini API key after trim; attempted env var: ${envVarName}`);
    throw new Error('Gemini API key is missing after trim.');
  }
  return key;
}

function normalizeDirectionValue(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const v = String(raw).trim();
  if (!v) return undefined;
  const lower = v.toLowerCase();

  if (lower === 'long') return 'Bullish';
  if (lower === 'short') return 'Bearish';
  if (lower === 'bullish') return 'Bullish';
  if (lower === 'bearish') return 'Bearish';
  if (lower === 'neutral') return 'Neutral';

  return v;
}

function parseAiPrediction(payload: unknown): AiPredictionResult {
  let workingPayload = payload as unknown;

  if (workingPayload && typeof workingPayload === 'object') {
    const draft = workingPayload as { direction?: unknown };
    const normalized = normalizeDirectionValue(draft.direction);
    if (normalized) {
      draft.direction = normalized;
    }
    workingPayload = draft;
  }

  const strict = aiPredictionSchema.safeParse(workingPayload);
  if (strict.success) return strict.data;
  const zodErr = strict.error;
  logZodError(zodErr);
  const partial = aiPredictionPartialSchema.safeParse(workingPayload);
  if (partial.success) return partial.data as AiPredictionResult;
  throw zodErr;
}

function validatePredictionConsistency(result: AiPredictionResult): string | null {
  if (result.direction === 'Bullish' && result.target_percentage < 0) return 'Bullish direction must not have a negative target percentage.';
  if (result.direction === 'Bearish' && result.target_percentage > 0) return 'Bearish direction must not have a positive target percentage.';
  if (result.direction === 'Neutral' && Math.abs(result.target_percentage) > 2) return 'Neutral direction target must stay within +/-2%.';
  return null;
}

/** Timeframe trend: bullish if close > EMA20 and RSI < 70; bearish if close < EMA20 and RSI > 30; else neutral. */
function getTimeframeTrend(closes: number[], opens?: number[]): 'bullish' | 'bearish' | 'neutral' {
  if (closes.length < 21) return 'neutral';
  const rsi = computeRSI(closes, 14);
  const ema20Val = ema(closes, 20);
  if (ema20Val == null) return 'neutral';
  const lastClose = closes[closes.length - 1]!;
  if (lastClose > ema20Val && rsi < 70) return 'bullish';
  if (lastClose < ema20Val && rsi > 30) return 'bearish';
  return 'neutral';
}

/** Fetch klines for one interval (e.g. 1h, 4h, 1d). Returns openTimes for alignment with OI. */
async function fetchKlinesForInterval(
  symbol: string,
  interval: string,
  limit: number
): Promise<{ opens: number[]; highs: number[]; lows: number[]; closes: number[]; volumes: number[]; openTimes: number[] }> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const res = await fetchWithBackoff(url, { timeoutMs: APP_CONFIG.fetchTimeoutMs, maxRetries: 2, cache: 'no-store' });
  if (!res.ok) return { opens: [], highs: [], lows: [], closes: [], volumes: [], openTimes: [] };
  const data = (await res.json()) as Array<[number, string, string, string, string, string]>;
  const valid = data.filter((row) => isValidBinanceKlineRow(row));
  return {
    opens: valid.map((r) => parseFloat(String(r[1]))),
    highs: valid.map((r) => parseFloat(String(r[2]))),
    lows: valid.map((r) => parseFloat(String(r[3]))),
    closes: valid.map((r) => parseFloat(String(r[4]))),
    volumes: valid.map((r) => parseFloat(String(r[5]))),
    openTimes: valid.map((r) => r[0] as number),
  };
}

/** High Volume Nodes: price levels (bins) with highest cumulative volume. Returns up to 5 levels. */
function computeHVN(highs: number[], lows: number[], volumes: number[], buckets = 30): number[] {
  if (highs.length === 0 || lows.length === 0 || volumes.length === 0) return [];
  const minP = Math.min(...lows);
  const maxP = Math.max(...highs);
  const range = maxP - minP || 1;
  const bucketVol: number[] = new Array(buckets).fill(0);
  for (let i = 0; i < highs.length; i++) {
    const mid = ((highs[i]! + lows[i]!) / 2);
    const idx = Math.min(buckets - 1, Math.floor(((mid - minP) / range) * buckets));
    bucketVol[idx] += volumes[i] ?? 0;
  }
  const withPrice = bucketVol.map((vol, idx) => ({ price: minP + (range * (idx + 0.5)) / buckets, vol }));
  withPrice.sort((a, b) => b.vol - a.vol);
  return withPrice.slice(0, 5).map((x) => Math.round(x.price * 100) / 100);
}

export type DoAnalysisCoreOptions = {
  /** When true, do not send Telegram gem alert (used by scanner; scanner sends its own with 80% threshold). */
  skipGemAlert?: boolean;
  /** Pre-computed Macro Expert summary from scanner cycle; skips Groq Macro call and macro context fetch. */
  precomputedMacro?: ExpertMacroOutput;
  /** Output language for AI textual fields. */
  locale?: Locale;
};

/**
 * Runs full AI analysis for a symbol. Persists to DB and optionally sends gem alert when probability >= 75%.
 */
export async function doAnalysisCore(
  cleanSymbol: string,
  startedAt: number,
  useCache: boolean,
  options?: DoAnalysisCoreOptions
): Promise<{ success: true; data: PredictionRecord; chartData: BinanceKline[] }> {
  const outputLocale: Locale = options?.locale === 'en' ? 'en' : 'he';
  const textLanguage = outputLocale === 'he' ? 'Hebrew' : 'English';
  const localizedLanguageRule =
    outputLocale === 'he' ? 'fluent, professional Hebrew' : 'fluent, professional English';
  const hardLocaleDirective =
    outputLocale === 'he' ? '\nCRITICAL: You MUST answer in Hebrew. Do not use English.' : '';
  let activeModel = APP_CONFIG.primaryModel || 'gemini-2.0-flash';
  if (process.env.NODE_ENV === 'development') {
    console.log('[HEARTBEAT] doAnalysisCore started', { model: activeModel });
  }

  let fallbackUsed = false;
  const apiKey = getGeminiApiKeyFromEnvWithTrim('analysis-core');
  const genAI = new GoogleGenerativeAI(apiKey);

  if (useCache) {
    const cached = analysisDedupCache.get(cleanSymbol);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  const KLINES_LIMIT = 24;
  const binanceKlinesUrl = `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=1d&limit=${KLINES_LIMIT}`;
  const proxyKlinesUrl = APP_CONFIG.proxyBinanceUrl
    ? `${APP_CONFIG.proxyBinanceUrl}/api/v3/klines?symbol=${cleanSymbol}&interval=1d&limit=${KLINES_LIMIT}`
    : '';

  async function fetchBinanceWithFallback(): Promise<z.infer<typeof binanceKlinesSchema>> {
    try {
      const res = await fetchWithBackoff(binanceKlinesUrl, {
        timeoutMs: APP_CONFIG.fetchTimeoutMs,
        maxRetries: 4,
        cache: 'no-store',
      });
      if (!res.ok) {
        const rawBody = await res.text().catch(() => '');
        const bodyPreview = rawBody.trim().slice(0, 240);
        const msg =
          res.status === 451
            ? 'Request failed (451) for upstream API.'
            : `Request failed (${res.status}) for upstream API.${bodyPreview ? ` Body: ${bodyPreview}` : ''}`;
        throw new Error(msg);
      }
      const rawBody = await res.text();
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody) as unknown;
      } catch (parseErr) {
        const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        const preview = rawBody.trim().slice(0, 240);
        console.error('[Analysis] Binance klines returned non-JSON payload', {
          symbol: cleanSymbol,
          parseError: parseMsg,
          rawPreview: preview,
        });
        throw new Error(`Binance klines invalid JSON.${preview ? ` Raw: ${preview}` : ''}`);
      }
      return binanceKlinesSchema.parse(payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('451') && proxyKlinesUrl) {
        try {
          const proxyRes = await fetchWithBackoff(proxyKlinesUrl, { timeoutMs: APP_CONFIG.fetchTimeoutMs, maxRetries: 2, cache: 'no-store' });
          if (!proxyRes.ok) {
            const rawBody = await proxyRes.text().catch(() => '');
            const bodyPreview = rawBody.trim().slice(0, 240);
            throw new Error(`Request failed (${proxyRes.status}) for upstream API.${bodyPreview ? ` Body: ${bodyPreview}` : ''}`);
          }
          const rawBody = await proxyRes.text();
          let payload: unknown;
          try {
            payload = JSON.parse(rawBody) as unknown;
          } catch (parseErr) {
            const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
            const preview = rawBody.trim().slice(0, 240);
            console.error('[Analysis] Proxy Binance klines returned non-JSON payload', {
              symbol: cleanSymbol,
              parseError: parseMsg,
              rawPreview: preview,
            });
            throw new Error(`Proxy Binance klines invalid JSON.${preview ? ` Raw: ${preview}` : ''}`);
          }
          return binanceKlinesSchema.parse(payload);
        } catch (proxyErr) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[Analysis] Proxy Binance klines failed:', proxyErr instanceof Error ? proxyErr.message : proxyErr);
          }
        }
        throw new Error('DATA_UNAVAILABLE_451');
      }
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[Analysis] Binance klines fetch failed for', cleanSymbol, msg);
      }
      throw e;
    }
  }

  const nowMs = Date.now();
  const oiStartMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  const assetTicker = getAssetTickerFromSymbol(cleanSymbol);
  const repoPath = ASSET_REPO_MAP[assetTicker] ?? `${assetTicker.toLowerCase()}/${assetTicker.toLowerCase()}`;
  const [binanceData, fngData, sentimentResult, klines1h, klines4h, appSettings, klines4hContext, oiRows, whaleActivity, developerActivity, leviathanSnapshot] = await Promise.all([
    fetchBinanceWithFallback(),
    fetchJson('https://api.alternative.me/fng/?limit=1', 'force-cache', fearGreedSchema).catch(() => ({ data: [] as { value?: string; value_classification?: string }[] })),
    getMarketSentiment(cleanSymbol).catch(() => ({ score: 0, narrative: 'No news-based sentiment available.' })),
    fetchKlinesForInterval(cleanSymbol, '1h', 24),
    fetchKlinesForInterval(cleanSymbol, '4h', 24),
    getAppSettings(),
    fetchKlinesForInterval(cleanSymbol, '4h', 250),
    fetchOpenInterest(cleanSymbol, oiStartMs, nowMs).catch(() => [] as { timestamp: number; sumOpenInterest: number }[]),
    getRecentWhaleMovements(assetTicker).catch(() => ({
      assetTicker,
      status: 'AWAITING_LIVE_DATA' as const,
      totalMovements: null,
      severeInflowsToExchanges: null,
      largestMovementUsd: null,
      netExchangeFlowUsd: null,
      generatedAt: new Date().toISOString(),
      movements: [],
      providerNote: 'Whale provider unavailable for this cycle.',
    })),
    getDeveloperActivity(repoPath).catch(() => ({
      repoPath,
      generatedAt: new Date().toISOString(),
      commitsLast30Days: 0,
      latestCommits: [],
      latestReleases: [],
      severity: 'severe' as const,
      warning: 'Red Flag: Abandoned Project',
    })),
    getLeviathanSnapshot(cleanSymbol).catch(() => ({
      symbol: cleanSymbol,
      generatedAt: new Date().toISOString(),
      signals: [],
      institutionalWhaleContext: 'Leviathan providers unavailable for this cycle.',
    })),
  ]);

  const ohlcv: BinanceKline[] = binanceData
    .filter((k) => isValidBinanceKlineRow(k))
    .map((k) => ({
      date: new Date(Number(k[0])).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
    }));
  if (ohlcv.length === 0) throw new Error(`No market data returned for ${cleanSymbol}.`);

  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const last5Days = ohlcv.slice(-5);
  const closes = ohlcv.map((c) => c.close);
  const lastCandle = ohlcv[ohlcv.length - 1]!;
  const prevCandle = ohlcv[ohlcv.length - 2];
  const volumeDeltaPercent =
    prevCandle && prevCandle.volume > 0 ? ((lastCandle.volume - prevCandle.volume) / prevCandle.volume) * 100 : 0;
  const rsiLevel = computeRSI(closes, 14);
  const volatility = lastCandle.high > 0 && lastCandle.low >= 0 ? (lastCandle.high - lastCandle.low) / lastCandle.close : 0;
  const riskFactor = 1 + Math.min(2, volatility * 5);

  const highs = ohlcv.map((c) => c.high);
  const lows = ohlcv.map((c) => c.low);
  const volumes = ohlcv.map((c) => c.volume);
  const trend1d = getTimeframeTrend(closes);
  const trend1h = getTimeframeTrend(klines1h.closes);
  const trend4h = getTimeframeTrend(klines4h.closes);
  const hvnLevels = computeHVN(highs, lows, volumes);
  const agentFeedback = await getSuccessFailureFeedback(cleanSymbol);

  const atrVal = atr(highs, lows, closes, 14);
  const atrMultiplierSl = appSettings.risk.atrMultiplierSl ?? 2.5;
  const atrMultiplierTp = appSettings.risk.atrMultiplierTp ?? 4;
  const suggestedSlLong = atrVal != null ? currentPrice - atrVal * atrMultiplierSl : undefined;
  const suggestedTpLong = atrVal != null ? currentPrice + atrVal * atrMultiplierTp : undefined;
  const suggestedSlShort = atrVal != null ? currentPrice + atrVal * atrMultiplierSl : undefined;
  const suggestedTpShort = atrVal != null ? currentPrice - atrVal * atrMultiplierTp : undefined;

  let fng = { value: '50', value_classification: 'Neutral' };
  if (fngData?.data?.length) {
    fng = {
      value: fngData.data[0].value || '50',
      value_classification: fngData.data[0].value_classification || 'Neutral',
    };
  }

  const sentiment_score = sentimentResult.score;
  const market_narrative = sentimentResult.narrative;

  const db = await getDbAsync();
  const pastErrors = db
    .filter((p) => p.symbol === cleanSymbol && p.status === 'evaluated' && p.error_report)
    .slice(-5)
    .map((p) => ({
      date: p.prediction_date,
      prediction: p.predicted_direction,
      actual: p.actual_outcome,
      learning_note: p.error_report,
    }));

  /** Historical outcomes for same symbol (feedback loop). When SQLite is used, this populates from historical_predictions. */
  let historicalPredictionOutcomes: HistoricalPredictionOutcome[] = [];
  try {
    const rows = await getHistoricalBySymbol(cleanSymbol, 10);
    historicalPredictionOutcomes = rows.map((r) => ({
      prediction_date: r.prediction_date,
      predicted_direction: r.predicted_direction,
      probability: r.probability ?? null,
      target_percentage: r.target_percentage ?? null,
      outcome_label: r.outcome_label,
      absolute_error_pct: r.absolute_error_pct,
      price_diff_pct: r.price_diff_pct,
    }));
  } catch {
    // historical_predictions only available when DB_DRIVER=sqlite; ignore
  }

  const technicalIndicators: TechnicalIndicatorsInput = {
    rsi_14: rsiLevel,
    volatility_pct: volatility * 100,
    // Optional: set macd_signal when a real-time MACD (or other) indicator source is available
  };

  const allStrategyInsights = await listStrategyInsights();
  const strategyInsights = allStrategyInsights.filter((i) => i.status === 'approved');

  /** Build consensus input for MoE + Debate Room (parallel to main Gemini). */
  const macdSignal = computeMacdSignal(closes);
  const atrPct = atrVal != null && currentPrice > 0 ? (atrVal / currentPrice) * 100 : null;
  const nearestSrPct =
    hvnLevels.length > 0 && currentPrice > 0
      ? Math.min(
          ...hvnLevels.map((hvn) => Math.abs((currentPrice - hvn) / currentPrice) * 100)
        )
      : null;
  const volumeProfileSummary =
    hvnLevels.length > 0
      ? `רמות נפח גבוה (HVN): ${hvnLevels.map((h) => h.toFixed(2)).join(', ')}`
      : 'אין רמות HVN מחושבות';

  /** Enriched technical context (EMA20/50/200, Bollinger, market structure) + OI — same logic as backtest for 8 AM live parity. */
  let technicalContextTextHe: string | undefined;
  let assetMomentumTextHe: string | undefined;
  let openInterestSignal: string | null = null;
  const raw4h: RawKlineRow[] = klines4hContext.openTimes.map((openTime, i) => ({
    openTime,
    open: klines4hContext.opens[i] ?? 0,
    high: klines4hContext.highs[i] ?? 0,
    low: klines4hContext.lows[i] ?? 0,
    close: klines4hContext.closes[i] ?? 0,
    volume: klines4hContext.volumes[i] ?? 0,
  }));
  if (raw4h.length >= 30) {
    const closes4h = klines4hContext.closes;
    const highs4h = klines4hContext.highs;
    const lows4h = klines4hContext.lows;
    const idx = raw4h.length - 1;
    const ema20Series = computeEmaSeries(closes4h, 20);
    const ema50Series = computeEmaSeries(closes4h, 50);
    const ema200Series = computeEmaSeries(closes4h, 200);
    const bb = computeBollingerSeries(closes4h, 20, 2);
    const marketStructure = inferMarketStructure({ highs: highs4h, lows: lows4h, idx, window: 20 });
    const oiEnrichment = getOIEnrichmentForCandle(raw4h[idx]!.openTime, raw4h, oiRows);
    const built = buildTechnicalContext({
      idx,
      close: raw4h[idx]!.close,
      ema20: ema20Series[idx] ?? null,
      ema50: ema50Series[idx] ?? null,
      ema200: ema200Series[idx] ?? null,
      bbMid: bb.mid[idx] ?? null,
      bbUpper: bb.upper[idx] ?? null,
      bbLower: bb.lower[idx] ?? null,
      bbPercentB: bb.percentB[idx] ?? null,
      marketStructure,
      oiStatus: oiEnrichment.oiStatus,
      oiChangePct: oiEnrichment.oiChangePct,
    });
    technicalContextTextHe = built.technicalContextTextHe;
    assetMomentumTextHe = built.assetMomentumTextHe;
    openInterestSignal = formatOISignal(oiEnrichment);
  }

  const moeThreshold = appSettings.neural.moeConfidenceThreshold ?? 75;
  let consensusResult: ConsensusResult | null = null;
  const useCachedMacro = options?.precomputedMacro != null;
  const [orderBookDepth, macroContext] = await Promise.all([
    fetchBinanceOrderBookDepth(cleanSymbol, 50),
    useCachedMacro ? Promise.resolve(null) : fetchMacroContext(),
  ]);
  const orderBookSummary = summarizeOrderBookDepth(orderBookDepth, cleanSymbol);
  const macroContextStr = useCachedMacro
    ? 'Global macro (cached for this cycle).'
    : (macroContext!.dxyNote +
        (macroContext!.fearGreedIndex != null ? ` Fear & Greed: ${macroContext!.fearGreedIndex} (${macroContext!.fearGreedLabel ?? 'N/A'}).` : '') +
        (macroContext!.btcDominancePct != null ? ` BTC dominance: ${macroContext!.btcDominancePct}%.` : ''));
  // Explicit diagnostic visibility for env loading issues in production logs.
  getGroqApiKeyFromEnvWithLog('analysis-core');
  try {
    consensusResult = await runConsensusEngine(
      {
        symbol: cleanSymbol,
        current_price: currentPrice,
        rsi_14: rsiLevel,
        atr_value: atrVal ?? null,
        atr_pct_of_price: atrPct,
        macd_signal: macdSignal,
        volume_profile_summary: volumeProfileSummary,
        hvn_levels: hvnLevels,
        nearest_sr_distance_pct: nearestSrPct,
        volatility_pct: volatility * 100,
        btc_trend: trend1d,
        asset_momentum:
          assetMomentumTextHe ??
          (trend1d === 'bullish'
            ? 'מומנטום חיובי — טרנד יומי תומך'
            : trend1d === 'bearish'
              ? 'מומנטום שלילי — טרנד יומי יורד'
              : 'מומנטום ניטרלי'),
        technical_context: technicalContextTextHe,
        open_interest_signal: openInterestSignal,
        onchain_metric_shift: leviathanSnapshot.institutionalWhaleContext,
        macro_context: macroContextStr,
        order_book_summary: orderBookSummary,
        institutional_whale_context: leviathanSnapshot.institutionalWhaleContext,
      },
      { moeConfidenceThreshold: moeThreshold, precomputedMacro: options?.precomputedMacro }
    );
  } catch (consensusErr) {
    if (typeof console !== 'undefined' && console.warn) {
      console.error('[SIMULATION_AGENT_ERROR] Consensus/MoE (Market Risk) failed, continuing without MoE:', consensusErr instanceof Error ? consensusErr.message : consensusErr);
      console.warn('[Analysis] Consensus engine failed, continuing without MoE:', consensusErr instanceof Error ? consensusErr.message : consensusErr);
    }
  }

  const guardrailStatus = checkSentimentGuardrail(sentiment_score);
  if (guardrailStatus !== 'NORMAL') {
    const message = `🚨 RISK ALERT: Extreme Market Sentiment Detected (${guardrailStatus})!\nScore: ${sentiment_score.toFixed(2)}. Narrative: ${market_narrative}\nAction: Applying 50% confidence penalty to current prediction.`;
    const tgResult = await sendTelegramMessage(message);
    if (!tgResult.ok) {
      writeAudit({ event: 'telegram.guardrail_failed', level: 'warn', meta: { error: tgResult.error, statusCode: tgResult.statusCode } });
    }
  }

  const systemInstruction = `You are an Elite Quantitative Analyst and Principal AI Architect for crypto markets.
Your role: produce institutional-grade, deterministic price-direction predictions.

CRITICAL LOCALIZATION: ALL textual analysis, logic summaries, bottom lines, strategic advice, learning context, and evidence snippets MUST be generated in ${localizedLanguageRule}. Do not mix languages.

RULES:
1. All text outputs (logic, strategic_advice, learning_context, evidence_snippet) MUST be in ${textLanguage}.
2. Weigh explicitly: (a) Market Sentiment (sentiment_score, market_narrative), (b) Order Book / liquidity context if implied by volume and volatility, (c) Volatility (technical_indicators.volatility_pct), (d) Technicals (RSI, and any other provided indicators), (e) Historical Pattern Recognition using past_mistakes_to_learn_from and historical_prediction_outcomes to avoid repeating errors and to calibrate confidence, (f) multi_timeframe_trends (1h, 4h, 1d) — prefer alignment on at least 2 timeframes for high confidence, (g) hvn_levels (High Volume Nodes = dynamic support/resistance), (h) pattern_warnings — if present, reduce probability or add caveats, (i) whaleActivity with special emphasis that exchange inflows are bearish and exchange outflows can be bullish, (j) developerActivity with strong recent commits/releases interpreted as bullish while warning/severe inactivity is bearish.
3. Reply with ONLY a single valid JSON object in the response body. No markdown code fences, no explanation before or after. The field "symbol" must exactly match the request "asset".
4. Required fields: symbol (same as asset), probability (0-100 integer), target_percentage (number), direction (Bullish | Bearish | Neutral), risk_level (High | Medium | Low), logic (one concise analytical sentence summarizing your reasoning), strategic_advice, learning_context, sources (array of { source_name, source_type, timestamp, evidence_snippet, relevance_score }).
5. risk_level: High = extreme volatility or sentiment, Medium = elevated uncertainty, Low = stable regime.
6. Be conservative: when historical_prediction_outcomes show repeated misses or high absolute_error_pct, or when pattern_warnings exist, reduce probability or shift toward Neutral. Elite Gem requires trend confirmed on at least 2 timeframes.
7. Provide tactical_opinion_he: one short sentence in ${textLanguage} relating the ATR-based suggested_sl_long/suggested_tp_long (or short) and hvn_levels to your direction — e.g. where to place SL/TP relative to HVN.
8. BOTTOM LINE (beginner-friendly): Your logic and strategic_advice must allow the system to derive a single 1–2 sentence extremely simple summary in ${textLanguage} so a user with zero experience understands the final recommendation at a glance.${hardLocaleDirective}`;

  const promptData = {
    asset: cleanSymbol,
    current_price: currentPrice,
    ohlcv_last_5_days: last5Days,
    volume_delta_percent: volumeDeltaPercent,
    fear_and_greed_index: fng,
    technical_indicators: technicalIndicators,
    order_book_note: 'Order book depth not provided; infer from volume and volatility if available.',
    sentiment_score,
    market_narrative,
    past_mistakes_to_learn_from: pastErrors,
    historical_prediction_outcomes: historicalPredictionOutcomes,
    strategy_insights: strategyInsights,
    multi_timeframe_trends: { '1h': trend1h, '4h': trend4h, '1d': trend1d },
    hvn_levels: hvnLevels,
    pattern_warnings: agentFeedback.patternWarnings,
    atr_value: atrVal ?? null,
    suggested_sl_long: suggestedSlLong,
    suggested_tp_long: suggestedTpLong,
    suggested_sl_short: suggestedSlShort,
    suggested_tp_short: suggestedTpShort,
    whaleActivity,
    developerActivity,
    leviathan: {
      generatedAt: leviathanSnapshot.generatedAt,
      institutionalWhaleContext: leviathanSnapshot.institutionalWhaleContext,
      signals: leviathanSnapshot.signals.map((s) => ({
        provider: s.provider,
        ok: s.ok,
        summary: s.summary,
      })),
    },
  };

  const geminiTimeoutMs = APP_CONFIG.geminiTimeoutMs ?? 60_000;

  const promptText = JSON.stringify(promptData, null, 2);
  const generationConfig = { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' as const };

  let apiResult: { response: { text: () => string } };
  try {
    const selectedModel = resolveGeminiModel(activeModel);
    const model = genAI.getGenerativeModel(
      { model: selectedModel.model, systemInstruction },
      selectedModel.requestOptions
    );
    apiResult = await withGeminiRateLimitRetry(() =>
      withGeminiTimeout(
        model.generateContent({
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
          generationConfig,
        }),
        geminiTimeoutMs
      )
    );
  } catch (primaryErr) {
    const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    console.error('[doAnalysisCore] Primary Gemini error', {
      message: errMsg,
      is404Or500: is404Or500Error(primaryErr),
      isQuota: isQuotaExhaustedError(primaryErr),
    });
    if (is404Or500Error(primaryErr)) {
      console.warn('[Gemini] AI engine error (404/500) — logging and returning Pending Insight path:', errMsg);
      await recordAuditLog({
        action_type: 'AI_ENGINE_ERROR',
        payload_diff: { error: errMsg, model: activeModel || 'Unknown', symbol: cleanSymbol, source: 'doAnalysisCore' },
      }).catch(() => {});
      writeAudit({ event: 'analysis.ai_engine_error', level: 'warn', meta: { symbol: cleanSymbol, model: activeModel || 'Unknown', error: errMsg } });
      throw new Error(`AI_ENGINE_ERROR: ${errMsg}`);
    }
    if (isQuotaExhaustedError(primaryErr)) {
      fallbackUsed = true;
      activeModel = APP_CONFIG.quotaFallbackModel ?? activeModel;
      console.warn(
        `[Gemini] Primary model quota exhausted (429); falling back to ${activeModel} for symbol ${cleanSymbol}.`
      );
      try {
        const selectedFallback = resolveGeminiModel(activeModel);
        const fallbackModel = genAI.getGenerativeModel(
          { model: selectedFallback.model, systemInstruction },
          selectedFallback.requestOptions
        );
        apiResult = await withGeminiRateLimitRetry(() =>
          withGeminiTimeout(
            fallbackModel.generateContent({
              contents: [{ role: 'user', parts: [{ text: promptText }] }],
              generationConfig,
            }),
            geminiTimeoutMs
          )
        );
      } catch (fallbackErr) {
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error('[doAnalysisCore] Fallback Gemini error', {
          message: fallbackMsg,
          is404Or500: is404Or500Error(fallbackErr),
          isQuota: isQuotaExhaustedError(fallbackErr),
        });
        if (isQuotaExhaustedError(fallbackErr)) {
          throw new Error('QUOTA_EXHAUSTED_429');
        }
        if (is404Or500Error(fallbackErr)) {
          await recordAuditLog({
            action_type: 'AI_ENGINE_ERROR',
            payload_diff: { error: fallbackMsg, model: activeModel || 'Unknown', symbol: cleanSymbol, source: 'doAnalysisCore_fallback' },
          }).catch(() => {});
          writeAudit({ event: 'analysis.ai_engine_error', level: 'warn', meta: { symbol: cleanSymbol, model: activeModel || 'Unknown', error: fallbackMsg } });
          throw new Error(`AI_ENGINE_ERROR: ${fallbackMsg}`);
        }
        throw fallbackErr;
      }
    } else {
      throw primaryErr;
    }
  }

  if (!apiResult.response.text()) {
    const previousModel = activeModel;
    fallbackUsed = true;
    activeModel = APP_CONFIG.fallbackModel ?? activeModel;
    console.warn(
      `[Gemini] Empty response from ${previousModel}; retrying with fallback model (${activeModel}) for symbol ${cleanSymbol}.`
    );
    const selectedRetryModel = resolveGeminiModel(activeModel);
    const emptyRetryModel = genAI.getGenerativeModel(
      { model: selectedRetryModel.model, systemInstruction },
      selectedRetryModel.requestOptions
    );
    apiResult = await withGeminiRateLimitRetry(() =>
      withGeminiTimeout(
        emptyRetryModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
          generationConfig,
        }),
        geminiTimeoutMs
      )
    );
  }

  const responseText = apiResult.response.text();
  if (!responseText) throw new Error('No response from AI');
  const parsed = parseJsonWithFallback<unknown>(responseText);
  let result: AiPredictionResult = parseAiPrediction(parsed);
  result = { ...result, symbol: cleanSymbol };

  // Apply Agent Reflex confidence penalty when high-risk pattern detected (smart-agent feedback).
  if (agentFeedback.confidencePenalty > 0) {
    result = {
      ...result,
      probability: Math.max(0, Math.min(100, result.probability - agentFeedback.confidencePenalty)),
    };
  }

  // Debate Room gate: only positive (Bullish) prediction if Final_Confidence >= MoE threshold.
  if (consensusResult && !consensusResult.consensus_approved && result.direction === 'Bullish') {
    result = {
      ...result,
      direction: 'Neutral',
      probability: Math.min(result.probability, 55),
      logic: `${result.logic} [קונצנזוס: ציון ${consensusResult.final_confidence.toFixed(1)} מתחת ל-${moeThreshold} — הוחלט להוריד להמלצה ניטרלית.]`,
    };
  }

  let validationRepaired = false;

  if (guardrailStatus !== 'NORMAL') {
    result = { ...result, probability: Math.round(result.probability * 0.5) };
  }

  const consistencyIssue = validatePredictionConsistency(result);
  if (consistencyIssue) {
    const repairPrompt = {
      issue: consistencyIssue,
      original: result,
      instruction: 'Reply with ONLY a single valid JSON object. No markdown, no explanation. Return corrected prediction with direction and target_percentage consistent. Include risk_level (High/Medium/Low) and all required fields: symbol, probability, target_percentage, direction, risk_level, logic, strategic_advice, learning_context, sources.',
    };
    const repairSystemInstruction = 'You return only valid JSON. No markdown code fences, no extra text. Fix the prediction object so direction and target_percentage are consistent.';
    const selectedRepairModel = resolveGeminiModel(activeModel);
    const repairModel = genAI.getGenerativeModel(
      { model: selectedRepairModel.model, systemInstruction: repairSystemInstruction },
      selectedRepairModel.requestOptions
    );
    const repairResponse = await withGeminiRateLimitRetry(() =>
      withGeminiTimeout(
        repairModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(repairPrompt) }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json' as const },
        }),
        geminiTimeoutMs
      )
    );
    let repairText: string | undefined;
    try {
      repairText = repairResponse.response.text();
    } catch {
      repairText = undefined;
    }
    if (repairText) {
      const repaired = parseAiPrediction(parseJsonWithFallback<unknown>(repairText));
      if (!validatePredictionConsistency(repaired)) {
        result = { ...repaired, symbol: cleanSymbol };
        validationRepaired = true;
      }
    }
    if (validatePredictionConsistency(result)) throw new Error('AI response remained inconsistent after repair.');
  }

  const dirToTrend = (d: string) => (d === 'Bullish' ? 'bullish' : d === 'Bearish' ? 'bearish' : 'neutral');
  const targetTrend = dirToTrend(result.direction);
  const trendConfirmedTimeframes =
    (trend1h === targetTrend ? 1 : 0) + (trend4h === targetTrend ? 1 : 0) + (trend1d === targetTrend ? 1 : 0);

  const riskStatus: PredictionRecord['risk_status'] =
    guardrailStatus === 'EXTREME_FEAR' ? 'extreme_fear' : guardrailStatus === 'EXTREME_GREED' ? 'extreme_greed' : 'normal';
  const risk_level_he =
    outputLocale === 'he'
      ? (result.risk_level === 'High'
          ? 'סיכון גבוה'
          : result.risk_level === 'Medium'
            ? 'סיכון בינוני'
            : result.risk_level === 'Low'
              ? 'סיכון נמוך'
              : getRiskLevelHe(riskFactor, riskStatus))
      : (result.risk_level === 'High'
          ? 'High risk'
          : result.risk_level === 'Medium'
            ? 'Medium risk'
            : 'Low risk');
  const { bottom_line_he, forecast_24h_he } =
    outputLocale === 'he'
      ? buildHebrewReport({
          direction: result.direction,
          probability: result.probability,
          targetPercentage: result.target_percentage,
          riskLevelHe: risk_level_he,
          symbol: cleanSymbol,
        })
      : {
          bottom_line_he: `${cleanSymbol}: ${result.direction} outlook with ${result.probability}% confidence (${risk_level_he}).`,
          forecast_24h_he: `24h projection: ${result.target_percentage >= 0 ? '+' : ''}${result.target_percentage.toFixed(1)}% from current levels.`,
        };
  const confidenceForRisk = consensusResult?.final_confidence ?? result.probability;
  const marketVolatilityPct = volatility * 100;
  const positionSizing = calculatePositionSize(
    REFERENCE_ACCOUNT_BALANCE_USD,
    confidenceForRisk,
    marketVolatilityPct
  );
  const tradeDirection = result.direction === 'Bullish' ? 'LONG' : result.direction === 'Bearish' ? 'SHORT' : null;
  const dynamicTradeLevels =
    tradeDirection != null ? calculateTradeLevels(currentPrice, marketVolatilityPct, tradeDirection) : null;

  const newRecord: PredictionRecord = {
    id: crypto.randomUUID(),
    symbol: cleanSymbol,
    prediction_date: new Date().toISOString(),
    predicted_direction: result.direction,
    probability: result.probability,
    target_percentage: result.target_percentage,
    entry_price: currentPrice,
    logic: result.logic,
    strategic_advice: result.strategic_advice,
    learning_context: result.learning_context,
    sources: result.sources,
    status: 'pending',
    model_name: activeModel,
    fallback_used: fallbackUsed,
    latency_ms: Date.now() - startedAt,
    validation_repaired: validationRepaired,
    sentiment_score,
    market_narrative,
    risk_status: riskStatus,
    bottom_line_he,
    risk_level_he,
    forecast_24h_he,
    trend_confirmed_timeframes: trendConfirmedTimeframes,
    hvn_levels: hvnLevels.length > 0 ? hvnLevels : undefined,
    pattern_warnings: agentFeedback.patternWarnings.length > 0 ? agentFeedback.patternWarnings : undefined,
    suggested_sl: result.direction === 'Bullish' ? suggestedSlLong : result.direction === 'Bearish' ? suggestedSlShort : undefined,
    suggested_tp: result.direction === 'Bullish' ? suggestedTpLong : result.direction === 'Bearish' ? suggestedTpShort : undefined,
    suggested_position_size_usd: positionSizing.positionSizeUsd,
    suggested_risk_fraction: positionSizing.riskFraction,
    tactical_opinion_he: result.tactical_opinion_he,
    ...(dynamicTradeLevels && {
      suggested_sl: dynamicTradeLevels.stopLoss,
      suggested_tp: dynamicTradeLevels.takeProfit,
    }),
    // Holistic 6+1 Board: Overseer's master_insight_he is the single source saved to DB and sent to Telegram.
    ...(consensusResult && {
      tech_score: consensusResult.tech_score,
      risk_score: consensusResult.risk_score,
      psych_score: consensusResult.psych_score,
      macro_score: consensusResult.macro_score,
      macro_logic: consensusResult.macro_logic,
      onchain_score: consensusResult.onchain_score,
      onchain_logic: consensusResult.onchain_logic,
      deep_memory_score: consensusResult.deep_memory_score,
      deep_memory_logic: consensusResult.deep_memory_logic,
      master_insight_he: consensusResult.master_insight_he,
      reasoning_path: consensusResult.reasoning_path,
      final_confidence: consensusResult.final_confidence,
      ...(consensusResult.debate_resolution?.trim()
        ? { debate_resolution: consensusResult.debate_resolution.trim() }
        : {}),
    }),
  };

  db.push(newRecord);
  await saveDbAsync(db);
  if (consensusResult) {
    void executeAutonomousConsensusSignal({
      predictionId: newRecord.id,
      symbol: cleanSymbol,
      predictedDirection: newRecord.predicted_direction,
      finalConfidence: consensusResult.final_confidence,
      marketVolatility: marketVolatilityPct,
      consensusApproved: consensusResult.consensus_approved,
      consensusReasoning: {
        overseerSummary: consensusResult.master_insight_he,
        overseerReasoningPath: consensusResult.reasoning_path,
        expertBreakdown: {
          technician: {
            score: consensusResult.tech_score,
            logic: consensusResult.tech_logic,
          },
          riskManager: {
            score: consensusResult.risk_score,
            logic: consensusResult.risk_logic,
          },
          marketPsychologist: {
            score: consensusResult.psych_score,
            logic: consensusResult.psych_logic,
          },
          macroOrderBook: {
            score: consensusResult.macro_score,
            logic: consensusResult.macro_logic,
          },
          onChainSleuth: {
            score: consensusResult.onchain_score,
            logic: consensusResult.onchain_logic,
          },
          deepMemory: {
            score: consensusResult.deep_memory_score,
            logic: consensusResult.deep_memory_logic,
          },
        },
      },
    }).catch((err) => {
      console.warn(
        '[ExecutionEngine] Autonomous execution failed:',
        err instanceof Error ? err.message : String(err)
      );
    });
  }
  if (consensusResult) {
    const expertSummaries = [
      `Technician: score=${consensusResult.tech_score}, logic=${consensusResult.tech_logic}`,
      `Risk: score=${consensusResult.risk_score}, logic=${consensusResult.risk_logic}`,
      `Psych: score=${consensusResult.psych_score}, logic=${consensusResult.psych_logic}`,
      `Macro: score=${consensusResult.macro_score}, logic=${consensusResult.macro_logic}`,
      `OnChain: score=${consensusResult.onchain_score}, logic=${consensusResult.onchain_logic}`,
      `DeepMemory: score=${consensusResult.deep_memory_score}, logic=${consensusResult.deep_memory_logic}`,
    ];
    await storeBoardMeetingMemory({
      triggerType: 'analysis',
      source: 'analysis_core',
      symbol: cleanSymbol,
      occurredAt: newRecord.prediction_date,
      finalConsensus: `${consensusResult.master_insight_he} | final_confidence=${consensusResult.final_confidence}`,
      expertSummaries,
    });
  }

  writeAudit({ event: 'analysis.success', meta: { symbol: cleanSymbol, model: activeModel || 'Unknown', fallbackUsed } });

  const gemAlertThreshold = appSettings.neural?.moeConfidenceThreshold ?? appSettings.scanner?.aiConfidenceThreshold ?? 75;
  if (!options?.skipGemAlert && result.probability >= gemAlertThreshold) {
    const gemScoreLine = consensusResult?.final_confidence != null ? `\nציון Gem (MoE): ${consensusResult.final_confidence.toFixed(1)}/100` : '';
    const insightLine = consensusResult?.master_insight_he ? `\n\nתובנת קונצנזוס: ${consensusResult.master_insight_he.slice(0, 300)}` : '';
    const macroLine = consensusResult?.macro_logic?.trim() ? `\n\nמקרו/Order Book: ${consensusResult.macro_logic.slice(0, 200)}` : '';
    const onchainLine = consensusResult?.onchain_logic?.trim() ? `\n\nOn-Chain: ${consensusResult.onchain_logic.slice(0, 150)}` : '';
    const deepMemoryLine = consensusResult?.deep_memory_logic?.trim() ? `\n\nDeep Memory: ${consensusResult.deep_memory_logic.slice(0, 150)}` : '';
    sendGemAlert({
      symbol: cleanSymbol,
      entryPrice: currentPrice,
      amountUsd: 100,
      messageText: `💎 <b>ג'ם זוהה</b>\n\nנכס: ${cleanSymbol.replace('USDT', '')}\nמחיר: $${currentPrice.toLocaleString()}\nהסתברות: ${result.probability}%\nכיוון: ${result.direction}${gemScoreLine}${insightLine}${macroLine}${onchainLine}${deepMemoryLine}\n\nבחר פעולה:`,
    }).catch(() => {});
  }

  newRecord.sources = newRecord.sources
    ?.map((source) => sourceCitationSchema.parse(source))
    .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));

  const output = {
    success: true as const,
    data: newRecord,
    chartData: ohlcv,
    riskManagement: {
      suggestedPositionSize: newRecord.suggested_position_size_usd ?? 0,
      stopLoss: newRecord.suggested_sl ?? null,
      takeProfit: newRecord.suggested_tp ?? null,
      positionRejected: positionSizing.rejected,
      rationale: positionSizing.reason,
    },
  };
  analysisDedupCache.set(cleanSymbol, {
    expiresAt: Date.now() + APP_CONFIG.analysisDedupWindowMs,
    result: output,
  });
  return output;
}
