/**
 * Core AI analysis logic: Binance + F&G + Sentiment + Gemini → PredictionRecord.
 * Institutional-grade Quantitative AI engine: rich payload, Quant persona, feedback loop.
 * Shared by UI (actions) and the live scanning worker.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { getDbAsync, saveDbAsync, type PredictionRecord, type SourceCitation } from '@/lib/db';
import { getGeminiApiKey } from '@/lib/env';
import { APP_CONFIG } from '@/lib/config';
import { aiPredictionSchema, aiPredictionPartialSchema, binanceKlinesSchema, fearGreedSchema, sourceCitationSchema, type RiskLevel } from '@/lib/schemas';
import { listStrategyInsights } from '@/lib/db/strategy-repository';
import { getHistoricalBySymbol } from '@/lib/db/historical-predictions';
import { z } from 'zod';
import { writeAudit } from '@/lib/audit';
import { getMarketSentiment, checkSentimentGuardrail } from '@/lib/agents/news-agent';
import { computeRSI, getRiskLevelHe, buildHebrewReport } from '@/lib/prediction-formula';
import { sendTelegramMessage, sendGemAlert } from '@/lib/telegram';
import type { BinanceKline } from '@/lib/actions-types';

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
}

type DedupEntry = {
  expiresAt: number;
  result: { success: true; data: PredictionRecord; chartData: BinanceKline[] };
};

const analysisDedupCache = new Map<string, DedupEntry>();

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
      const jitter = Math.floor(Math.random() * 180);
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
      const msg = res.status === 451 ? 'Request failed (451) for upstream API.' : `Request failed (${res.status}) for upstream API.`;
      throw new Error(msg);
    }
    const payload = (await res.json()) as unknown;
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

function parseAiPrediction(payload: unknown): AiPredictionResult {
  const strict = aiPredictionSchema.safeParse(payload);
  if (strict.success) return strict.data;
  const zodErr = strict.error;
  logZodError(zodErr);
  const partial = aiPredictionPartialSchema.safeParse(payload);
  if (partial.success) return partial.data as AiPredictionResult;
  throw zodErr;
}

function validatePredictionConsistency(result: AiPredictionResult): string | null {
  if (result.direction === 'Bullish' && result.target_percentage < 0) return 'Bullish direction must not have a negative target percentage.';
  if (result.direction === 'Bearish' && result.target_percentage > 0) return 'Bearish direction must not have a positive target percentage.';
  if (result.direction === 'Neutral' && Math.abs(result.target_percentage) > 2) return 'Neutral direction target must stay within +/-2%.';
  return null;
}

export type DoAnalysisCoreOptions = {
  /** When true, do not send Telegram gem alert (used by scanner; scanner sends its own with 80% threshold). */
  skipGemAlert?: boolean;
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
      return await fetchJson(binanceKlinesUrl, 'no-store', binanceKlinesSchema);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('451') && proxyKlinesUrl) return await fetchJson(proxyKlinesUrl, 'no-store', binanceKlinesSchema);
      if (msg.includes('451')) throw new Error('DATA_UNAVAILABLE_451');
      throw e;
    }
  }

  const [binanceData, fngData, sentimentResult] = await Promise.all([
    fetchBinanceWithFallback(),
    fetchJson('https://api.alternative.me/fng/?limit=1', 'force-cache', fearGreedSchema).catch(() => ({ data: [] as { value?: string; value_classification?: string }[] })),
    getMarketSentiment(cleanSymbol).catch(() => ({ score: 0, narrative: 'No news-based sentiment available.' })),
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
    const rows = getHistoricalBySymbol(cleanSymbol, 10);
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

  const guardrailStatus = checkSentimentGuardrail(sentiment_score);
  if (guardrailStatus !== 'NORMAL') {
    const message = `🚨 RISK ALERT: Extreme Market Sentiment Detected (${guardrailStatus})!\nScore: ${sentiment_score.toFixed(2)}. Narrative: ${market_narrative}\nAction: Applying 50% confidence penalty to current prediction.`;
    const tgResult = await sendTelegramMessage(message);
    if (!tgResult.ok) {
      writeAudit({ event: 'telegram.guardrail_failed', level: 'warn', meta: { error: tgResult.error, statusCode: tgResult.statusCode } });
    }
  }

  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `You are an Elite Quantitative Analyst and Principal AI Architect for crypto markets.
Your role: produce institutional-grade, deterministic price-direction predictions.

CRITICAL LOCALIZATION: ALL textual analysis, logic summaries, bottom lines, strategic advice, learning context, and evidence snippets MUST be generated in fluent, professional Hebrew. Do not output English text for these fields.

RULES:
1. All text outputs (logic, strategic_advice, learning_context, evidence_snippet) MUST be in Hebrew.
2. Weigh explicitly: (a) Market Sentiment (sentiment_score, market_narrative), (b) Order Book / liquidity context if implied by volume and volatility, (c) Volatility (technical_indicators.volatility_pct), (d) Technicals (RSI, and any other provided indicators), (e) Historical Pattern Recognition using past_mistakes_to_learn_from and historical_prediction_outcomes to avoid repeating errors and to calibrate confidence.
3. Output ONLY valid JSON. The field "symbol" must exactly match the request "asset".
4. Required fields: symbol (same as asset), probability (0-100 integer), target_percentage (number), direction (Bullish | Bearish | Neutral), risk_level (High | Medium | Low), logic (one concise analytical sentence in Hebrew summarizing your reasoning), strategic_advice (Hebrew), learning_context (Hebrew), sources (array of { source_name, source_type, timestamp, evidence_snippet, relevance_score }).
5. risk_level: High = extreme volatility or sentiment, Medium = elevated uncertainty, Low = stable regime.
6. Be conservative: when historical_prediction_outcomes show repeated misses or high absolute_error_pct, reduce probability or shift toward Neutral.`;

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
  };

  let activeModel = APP_CONFIG.primaryModel;
  let fallbackUsed = false;
  const geminiTimeoutMs = APP_CONFIG.geminiTimeoutMs ?? 60_000;

  const responseSchema = {
    type: Type.OBJECT as const,
    properties: {
      symbol: { type: Type.STRING },
      probability: { type: Type.INTEGER, description: '0-100' },
      target_percentage: { type: Type.NUMBER, description: 'Expected % move' },
      direction: { type: Type.STRING, enum: ['Bullish', 'Bearish', 'Neutral'] },
      risk_level: { type: Type.STRING, enum: ['High', 'Medium', 'Low'], description: 'Risk level of the prediction' },
      logic: { type: Type.STRING },
      strategic_advice: { type: Type.STRING },
      learning_context: { type: Type.STRING },
      sources: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            source_name: { type: Type.STRING },
            source_type: { type: Type.STRING, enum: ['market_data', 'sentiment', 'historical', 'derived'] },
            timestamp: { type: Type.STRING },
            evidence_snippet: { type: Type.STRING },
            relevance_score: { type: Type.NUMBER },
          },
          required: ['source_name', 'source_type', 'timestamp', 'evidence_snippet', 'relevance_score'],
        },
        description: 'Structured sources and evidence used in analysis',
      },
    },
    required: ['symbol', 'probability', 'target_percentage', 'direction', 'risk_level', 'logic', 'strategic_advice', 'learning_context', 'sources'],
  };

  let response = await withGeminiTimeout(ai.models.generateContent({
    model: activeModel,
    contents: JSON.stringify(promptData, null, 2),
    config: {
      systemInstruction,
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema,
    },
  }), geminiTimeoutMs);

  if (!response.text) {
    fallbackUsed = true;
    activeModel = APP_CONFIG.fallbackModel;
    response = await withGeminiTimeout(ai.models.generateContent({
      model: activeModel,
      contents: JSON.stringify(promptData, null, 2),
      config: {
        systemInstruction,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema,
      },
    }), geminiTimeoutMs);
  }

  if (!response.text) throw new Error('No response from AI');
  const parsed = JSON.parse(response.text) as unknown;
  let result: AiPredictionResult = parseAiPrediction(parsed);
  result = { ...result, symbol: cleanSymbol };

  let validationRepaired = false;

  if (guardrailStatus !== 'NORMAL') {
    result = { ...result, probability: Math.round(result.probability * 0.5) };
  }

  const consistencyIssue = validatePredictionConsistency(result);
  if (consistencyIssue) {
    const repairPrompt = {
      issue: consistencyIssue,
      original: result,
      instruction: 'Return corrected JSON while preserving intent. Ensure direction and target_percentage are consistent. Include risk_level (High/Medium/Low).',
    };
    const repairResponse = await withGeminiTimeout(ai.models.generateContent({
      model: activeModel,
      contents: JSON.stringify(repairPrompt),
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            symbol: { type: Type.STRING },
            probability: { type: Type.INTEGER },
            target_percentage: { type: Type.NUMBER },
            direction: { type: Type.STRING, enum: ['Bullish', 'Bearish', 'Neutral'] },
            risk_level: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
            logic: { type: Type.STRING },
            strategic_advice: { type: Type.STRING },
            learning_context: { type: Type.STRING },
            sources: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  source_name: { type: Type.STRING },
                  source_type: { type: Type.STRING, enum: ['market_data', 'sentiment', 'historical', 'derived'] },
                  timestamp: { type: Type.STRING },
                  evidence_snippet: { type: Type.STRING },
                  relevance_score: { type: Type.NUMBER },
                },
                required: ['source_name', 'source_type', 'timestamp', 'evidence_snippet', 'relevance_score'],
              },
            },
          },
          required: ['symbol', 'probability', 'target_percentage', 'direction', 'risk_level', 'logic', 'strategic_advice', 'learning_context', 'sources'],
        },
      },
    }), geminiTimeoutMs);
    if (repairResponse.text) {
      const repaired = parseAiPrediction(JSON.parse(repairResponse.text));
      if (!validatePredictionConsistency(repaired)) {
        result = { ...repaired, symbol: cleanSymbol };
        validationRepaired = true;
      }
    }
    if (validatePredictionConsistency(result)) throw new Error('AI response remained inconsistent after repair.');
  }

  const riskStatus: PredictionRecord['risk_status'] =
    guardrailStatus === 'EXTREME_FEAR' ? 'extreme_fear' : guardrailStatus === 'EXTREME_GREED' ? 'extreme_greed' : 'normal';
  const risk_level_he =
    result.risk_level === 'High'
      ? 'סיכון גבוה'
      : result.risk_level === 'Medium'
        ? 'סיכון בינוני'
        : result.risk_level === 'Low'
          ? 'סיכון נמוך'
          : getRiskLevelHe(riskFactor, riskStatus);
  const { bottom_line_he, forecast_24h_he } = buildHebrewReport({
    direction: result.direction,
    probability: result.probability,
    targetPercentage: result.target_percentage,
    riskLevelHe: risk_level_he,
    symbol: cleanSymbol,
  });

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
  };

  db.push(newRecord);
  await saveDbAsync(db);

  writeAudit({ event: 'analysis.success', meta: { symbol: cleanSymbol, model: activeModel, fallbackUsed } });

  if (!options?.skipGemAlert && result.probability >= 75) {
    sendGemAlert({
      symbol: cleanSymbol,
      entryPrice: currentPrice,
      amountUsd: 100,
      messageText: `💎 <b>ג'ם זוהה</b>\n\nנכס: ${cleanSymbol.replace('USDT', '')}\nמחיר: $${currentPrice.toLocaleString()}\nהסתברות: ${result.probability}%\nכיוון: ${result.direction}\n\nבחר פעולה:`,
    }).catch(() => {});
  }

  newRecord.sources = newRecord.sources
    ?.map((source) => sourceCitationSchema.parse(source))
    .sort((a, b) => b.relevance_score - a.relevance_score);

  const output = { success: true, data: newRecord, chartData: ohlcv };
  analysisDedupCache.set(cleanSymbol, {
    expiresAt: Date.now() + APP_CONFIG.analysisDedupWindowMs,
    result: output,
  });
  return output;
}
