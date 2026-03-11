'use server';

import { GoogleGenAI, Type } from '@google/genai';
import { getDbAsync, saveDbAsync, PredictionRecord, SourceCitation } from '@/lib/db';
import { getGeminiApiKey } from '@/lib/env';
import { APP_CONFIG } from '@/lib/config';
import { allowRequest } from '@/lib/rate-limit';
import { allowDistributedRequest } from '@/lib/rate-limit-distributed';
import { aiPredictionSchema, binanceKlinesSchema, fearGreedSchema, sourceCitationSchema } from '@/lib/schemas';
import { listStrategyInsights, updateStrategyInsightStatus } from '@/lib/db/strategy-repository';
import { z } from 'zod';
import { cookies, headers } from 'next/headers';
import { writeAudit } from '@/lib/audit';
import { enqueueByKey } from '@/lib/task-queue';
import { createSessionToken, hasRequiredRole, isSessionEnabled, verifySessionToken, type SessionRole } from '@/lib/session';
import { evaluatePredictionOutcome } from '@/lib/agents/backtester';
import { getBacktestRepository } from '@/lib/db/backtest-repository';
import { getMarketSentiment, checkSentimentGuardrail } from '@/lib/agents/news-agent';
import { sendTelegramMessage } from '@/lib/telegram';

interface BinanceKline {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BinanceTickerPrice {
  symbol?: string;
  price: string;
}

interface AiPredictionResult {
  symbol: string;
  probability: number;
  target_percentage: number;
  direction: PredictionRecord['predicted_direction'];
  logic: string;
  strategic_advice: string;
  learning_context: string;
  sources: SourceCitation[];
}

type DedupEntry = {
  expiresAt: number;
  result: Awaited<ReturnType<typeof analyzeCrypto>>;
};

const analysisDedupCache = new Map<string, DedupEntry>();

type AnalyzeInput = {
  symbol: string;
  honeypot?: string;
  submittedAt?: number;
  captchaToken?: string;
};

async function requireAuth(requiredRole: SessionRole = 'viewer'): Promise<void> {
  if (!isSessionEnabled()) return;

  const jar = await cookies();
  const token = jar.get('app_auth_token')?.value || '';
  const session = verifySessionToken(token);
  if (!session || !hasRequiredRole(session.role, requiredRole)) {
    throw new Error('Unauthorized request.');
  }
}

async function verifyCaptcha(captchaToken?: string): Promise<boolean> {
  if (!APP_CONFIG.turnstileSecret) {
    return true;
  }
  if (!captchaToken) {
    return false;
  }

  const body = new URLSearchParams({
    secret: APP_CONFIG.turnstileSecret,
    response: captchaToken,
  });

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
    cache: 'no-store',
  });

  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return Boolean(data.success);
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

function normalizeSymbol(raw: string): string {
  const sanitized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!sanitized || sanitized.length < 3) {
    throw new Error('Invalid symbol. Please enter a valid trading pair such as BTCUSDT.');
  }

  if (sanitized.endsWith('USDT')) {
    return sanitized;
  }

  return `${sanitized}USDT`;
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

async function fetchJson<T>(url: string, cache: RequestCache = 'no-store', schema?: z.ZodType<T>): Promise<T> {
  const parsedUrl = new URL(url);
  if (!APP_CONFIG.trustedApiOrigins.includes(parsedUrl.origin as (typeof APP_CONFIG.trustedApiOrigins)[number])) {
    throw new Error('Untrusted upstream API endpoint.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APP_CONFIG.fetchTimeoutMs);

  try {
    const res = await withRetry(() => fetch(url, {
      cache,
      signal: controller.signal,
    }));

    if (!res.ok) {
      throw new Error(`Request failed (${res.status}) for upstream API.`);
    }

    const payload = (await res.json()) as unknown;
    return schema ? schema.parse(payload) : (payload as T);
  } finally {
    clearTimeout(timeout);
  }
}

function parseAiPrediction(payload: unknown): AiPredictionResult {
  const parsed = aiPredictionSchema.parse(payload);
  return parsed;
}

function validatePredictionConsistency(result: AiPredictionResult): string | null {
  if (result.direction === 'Bullish' && result.target_percentage < 0) {
    return 'Bullish direction must not have a negative target percentage.';
  }

  if (result.direction === 'Bearish' && result.target_percentage > 0) {
    return 'Bearish direction must not have a positive target percentage.';
  }

  if (result.direction === 'Neutral' && Math.abs(result.target_percentage) > 2) {
    return 'Neutral direction target must stay within +/-2%.';
  }

  return null;
}

export type SimulationResult =
  | { success: true; data: PredictionRecord; chartData: BinanceKline[] }
  | { success: false; error: string; requestId?: string };

async function doAnalysisCore(
  cleanSymbol: string,
  startedAt: number,
  useCache: boolean
): Promise<{ success: true; data: PredictionRecord; chartData: BinanceKline[] }> {
  if (useCache) {
    const cached = analysisDedupCache.get(cleanSymbol);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result as { success: true; data: PredictionRecord; chartData: BinanceKline[] };
    }
  }

  // 1. Fetch Binance Data (OHLCV) - 30 days for chart
  const binanceData = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=1d&limit=30`, 'no-store', binanceKlinesSchema);

  const ohlcv: BinanceKline[] = binanceData
    .filter((k) => isValidBinanceKlineRow(k))
    .map((k) => ({
      date: new Date(k[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  if (ohlcv.length === 0) {
    throw new Error(`No market data returned for ${cleanSymbol}.`);
  }

  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const last5Days = ohlcv.slice(-5);

  // 2. Fetch Fear & Greed Index
  let fng = { value: "50", value_classification: "Neutral" };
  try {
    const fngData = await fetchJson('https://api.alternative.me/fng/?limit=1', 'force-cache', fearGreedSchema);
    if (fngData && fngData.data && fngData.data.length > 0) {
      fng = {
        value: fngData.data[0].value || '50',
        value_classification: fngData.data[0].value_classification || 'Neutral',
      };
    }
  } catch {
    // Use default F&G when upstream fails
  }

  // 3. Get Past Errors (Learning Loop)
  const db = await getDbAsync();
  const pastErrors = db
    .filter(p => p.symbol === cleanSymbol && p.status === 'evaluated' && p.error_report)
    .slice(-5)
    .map(p => ({
      date: p.prediction_date,
      prediction: p.predicted_direction,
      actual: p.actual_outcome,
      learning_note: p.error_report
    }));

  // 4. Load strategy insights (Self-learning loop)
  const allStrategyInsights = await listStrategyInsights();
  const strategyInsights = allStrategyInsights.filter((i) => i.status === 'approved');

  // 5. Market sentiment from news (Sentiment Agent)
  let sentiment_score = 0;
  let market_narrative = 'No news-based sentiment available.';
  try {
    const sentiment = await getMarketSentiment(cleanSymbol);
    sentiment_score = sentiment.score;
    market_narrative = sentiment.narrative;
  } catch {
    // Use default sentiment when news fetch fails
  }

  // 5b. Sentiment Guardrail – risk alert and Telegram
  const guardrailStatus = checkSentimentGuardrail(sentiment_score);
  if (guardrailStatus !== 'NORMAL') {
    const message = `🚨 RISK ALERT: Extreme Market Sentiment Detected (${guardrailStatus})!\nScore: ${sentiment_score.toFixed(2)}. Narrative: ${market_narrative}\nAction: Applying 50% confidence penalty to current prediction.`;
    await sendTelegramMessage(message);
  }

  // 6. Call Gemini AI
  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction =
    "אתה אנליסט קריפטו מומחה בעל יכולות סטטיסטיות. תפקידך לנתח נתוני שוק ולזהות דפוסי פריצה (Breakout). עליך לאזן בין אינדיקטורים טכניים לבין הנרטיב והסנטימנט הנוכחי של השוק (sentiment_score, market_narrative). אל תתעלם מתנועות חדשות חזקות (FOMO/פאניקה) – התחשב בהן. פלוט את התחזית בפורמט JSON בלבד. חובה לכלול המלצות אסטרטגיות (strategic_advice), הקשר למידה מהעבר (learning_context) ומקורות מידע (sources).";

  const promptData = {
    asset: cleanSymbol,
    current_price: currentPrice,
    ohlcv_last_5_days: last5Days,
    fear_and_greed_index: fng,
    past_mistakes_to_learn_from: pastErrors,
    strategy_insights: strategyInsights,
    sentiment_score,
    market_narrative,
  };

  let activeModel = APP_CONFIG.primaryModel;
  let fallbackUsed = false;

  let response = await ai.models.generateContent({
    model: activeModel,
    contents: JSON.stringify(promptData, null, 2),
    config: {
      systemInstruction,
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          symbol: { type: Type.STRING },
          probability: { type: Type.INTEGER, description: "0-100" },
          target_percentage: { type: Type.NUMBER, description: "Expected % move" },
          direction: { type: Type.STRING, enum: ["Bullish", "Bearish", "Neutral"] },
          logic: { type: Type.STRING, description: "Explanation based on volume and sentiment" },
          strategic_advice: { type: Type.STRING, description: "Actionable investment advice for this specific asset (in Hebrew)" },
          learning_context: { type: Type.STRING, description: "How past predictions influenced this specific forecast (in Hebrew)" },
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
          }
        },
        required: ["symbol", "probability", "target_percentage", "direction", "logic", "strategic_advice", "learning_context", "sources"]
      }
    }
  });

  if (!response.text) {
    fallbackUsed = true;
    activeModel = APP_CONFIG.fallbackModel;
    response = await ai.models.generateContent({
      model: activeModel,
      contents: JSON.stringify(promptData, null, 2),
      config: {
        systemInstruction,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            symbol: { type: Type.STRING },
            probability: { type: Type.INTEGER, description: '0-100' },
            target_percentage: { type: Type.NUMBER, description: 'Expected % move' },
            direction: { type: Type.STRING, enum: ['Bullish', 'Bearish', 'Neutral'] },
            logic: { type: Type.STRING, description: 'Explanation based on volume and sentiment' },
            strategic_advice: { type: Type.STRING, description: 'Actionable investment advice for this specific asset (in Hebrew)' },
            learning_context: { type: Type.STRING, description: 'How past predictions influenced this specific forecast (in Hebrew)' },
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
            }
          },
          required: ['symbol', 'probability', 'target_percentage', 'direction', 'logic', 'strategic_advice', 'learning_context', 'sources']
        }
      }
    });
  }

  if (!response.text) throw new Error('No response from AI');
  let result = parseAiPrediction(JSON.parse(response.text));
  let validationRepaired = false;

  if (guardrailStatus !== 'NORMAL') {
    const finalProbability = Math.round(result.probability * 0.5);
    result = { ...result, probability: finalProbability };
  }

  const consistencyIssue = validatePredictionConsistency(result);
  if (consistencyIssue) {
    const repairPrompt = {
      issue: consistencyIssue,
      original: result,
      instruction: 'Return corrected JSON while preserving intent. Ensure direction and target_percentage are consistent.'
    };

    const repairResponse = await ai.models.generateContent({
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
              }
            },
            required: ['symbol', 'probability', 'target_percentage', 'direction', 'logic', 'strategic_advice', 'learning_context', 'sources']
          }
        }
      }
    });

    if (repairResponse.text) {
      const repaired = parseAiPrediction(JSON.parse(repairResponse.text));
      if (!validatePredictionConsistency(repaired)) {
        result = repaired;
        validationRepaired = true;
      }
    }

    if (validatePredictionConsistency(result)) {
      throw new Error('AI response remained inconsistent after repair.');
    }
  }

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
    risk_status: guardrailStatus === 'EXTREME_FEAR' ? 'extreme_fear' : guardrailStatus === 'EXTREME_GREED' ? 'extreme_greed' : 'normal',
  };

  db.push(newRecord);
  await saveDbAsync(db);

  writeAudit({ event: 'analysis.success', meta: { symbol: cleanSymbol, model: activeModel, fallbackUsed } });

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

export async function runCryptoAnalysisCore(
  rawSymbol: string,
  options?: { skipCache?: boolean }
): Promise<SimulationResult> {
  try {
    const cleanSymbol = normalizeSymbol((rawSymbol || '').trim());
    return await doAnalysisCore(cleanSymbol, Date.now(), !options?.skipCache);
  } catch (error: unknown) {
    const requestId = crypto.randomUUID();
    const err = error instanceof Error ? error.message : 'Analysis failed.';
    writeAudit({ event: 'analysis.failed', level: 'warn', meta: { requestId, errorType: error instanceof Error ? error.constructor.name : 'Unknown' } });
    return { success: false, error: err, requestId };
  }
}

export async function analyzeCrypto(inputOrSymbol: AnalyzeInput | string) {
  const input: AnalyzeInput = typeof inputOrSymbol === 'string' ? { symbol: inputOrSymbol } : inputOrSymbol;
  const inputSymbol = (input.symbol || '').trim();
  if (!inputSymbol) {
    return { success: false, error: 'Missing symbol.' };
  }

  return enqueueByKey(`analysis:${(inputSymbol || '').toUpperCase()}`, async () => {
  const startedAt = Date.now();
  try {
    await requireAuth('operator');

    if ((input.honeypot || '').trim() !== '') {
      throw new Error('Automation attempt detected.');
    }

    const submittedAt = Number(input.submittedAt || 0);
    if (!submittedAt || Date.now() - submittedAt < APP_CONFIG.minHumanDelayMs) {
      throw new Error('Submission was too fast. Please retry.');
    }

    const captchaPassed = await verifyCaptcha(input.captchaToken);
    if (!captchaPassed) {
      throw new Error('Captcha verification failed.');
    }

    const limiterKey = `analyze:${inputSymbol.toUpperCase().trim()}`;
    const distributedAllowed = await allowDistributedRequest(limiterKey, APP_CONFIG.analysisRateLimitMax, APP_CONFIG.analysisRateLimitWindowMs);
    const allowed = distributedAllowed ?? allowRequest(limiterKey, APP_CONFIG.analysisRateLimitMax, APP_CONFIG.analysisRateLimitWindowMs);
    if (!allowed) {
      writeAudit({ event: 'analysis.rate_limited', level: 'warn', meta: { key: limiterKey, distributed: distributedAllowed !== null } });
      return { success: false, error: 'Rate limit reached. Please wait and try again.' };
    }

    const cleanSymbol = normalizeSymbol(inputSymbol);
    return await doAnalysisCore(cleanSymbol, startedAt, true);
  } catch (error: unknown) {
    const requestId = crypto.randomUUID();
    const errorType = error instanceof Error ? error.constructor?.name : 'UnknownError';
    writeAudit({ event: 'analysis.failed', level: 'warn', meta: { requestId, errorType } });
    return { success: false, error: 'Analysis failed. Please try again.', requestId };
  }
  });
}

export async function getHistory() {
  await requireAuth('viewer');
  const rows = await getDbAsync();
  return rows.sort((a, b) => new Date(b.prediction_date).getTime() - new Date(a.prediction_date).getTime());
}

export async function evaluatePendingPredictions(options?: { internalWorker?: boolean }) {
  if (!options?.internalWorker) {
    await requireAuth('operator');
  }
  const db = await getDbAsync();
  const backtestRepo = await getBacktestRepository();
  let updatedCount = 0;

  let ai: GoogleGenAI;
  try {
    ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  } catch (error: any) {
    return { success: false, error: error.message || 'Gemini API key is missing or invalid.' };
  }

  const pendingSymbols = Array.from(new Set(db.filter((r) => r.status === 'pending').map((r) => r.symbol)));
  const priceMap = new Map<string, number>();

  if (pendingSymbols.length > 0) {
    try {
      const symbolsParam = encodeURIComponent(JSON.stringify(pendingSymbols));
      const rows = await fetchJson<BinanceTickerPrice[]>(`https://api.binance.com/api/v3/ticker/price?symbols=${symbolsParam}`);
      rows.forEach((row) => {
        if (!row.symbol) return;
        const parsed = parseFloat(row.price);
        if (Number.isFinite(parsed) && parsed > 0) {
          priceMap.set(row.symbol, parsed);
        }
      });
    } catch {
      // Fall back to per-symbol requests below when bulk endpoint is unavailable.
    }
  }

  for (let i = 0; i < db.length; i++) {
    const record = db[i];
    if (record.status === 'pending') {
      try {
        let currentPrice = priceMap.get(record.symbol);
        if (!currentPrice) {
          const binanceData = await fetchJson<BinanceTickerPrice>(`https://api.binance.com/api/v3/ticker/price?symbol=${record.symbol}`);
          currentPrice = parseFloat(binanceData.price);
        }
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
          continue;
        }

        const evaluation = evaluatePredictionOutcome(record, currentPrice);
        if (!evaluation) {
          continue;
        }

        const { isCorrect, priceDiffPct, absoluteErrorPct, outcomeLabel } = evaluation;

        record.actual_outcome = `Price moved by ${priceDiffPct.toFixed(2)}% to $${currentPrice}`;

        const requiresDeepAnalysis = absoluteErrorPct > 2;

        await backtestRepo.append({
          prediction_id: record.id,
          symbol: record.symbol,
          prediction_date: record.prediction_date,
          predicted_direction: record.predicted_direction,
          entry_price: record.entry_price,
          current_price: currentPrice,
          price_diff_pct: priceDiffPct,
          absolute_error_pct: absoluteErrorPct,
          outcome_label: outcomeLabel,
          requires_deep_analysis: requiresDeepAnalysis,
          evaluated_at: new Date().toISOString(),
          sentiment_score: record.sentiment_score,
          market_narrative: record.market_narrative,
        });

        if (!isCorrect) {
          const prompt = `
          You made a wrong prediction.
          Symbol: ${record.symbol}
          Your Prediction: ${record.predicted_direction}
          Entry Price: $${record.entry_price}
          Actual Current Price: $${currentPrice} (${priceDiffPct.toFixed(2)}% move)
          Your Logic was: ${record.logic}

          Analyze why this prediction failed. Provide a short, actionable learning note (1-2 sentences in Hebrew) to avoid this mistake next time.
          `;

          const response = await ai.models.generateContent({
            model: 'gemini-3.1-pro-preview',
            contents: prompt,
            config: { temperature: 0.2 }
          });

          record.error_report = response.text || "Failed to generate learning note.";
        } else {
          record.error_report = "התחזית הייתה נכונה. הדפוס אומת בהצלחה.";
        }

        record.status = 'evaluated';
        updatedCount++;
      } catch {
        writeAudit({ event: 'evaluation.record_failed', level: 'warn', meta: { symbol: record.symbol } });
      }
    }
  }

  if (updatedCount > 0) {
    await saveDbAsync(db);
    writeAudit({ event: 'evaluation.success', meta: { updatedCount } });
  }

  return { success: true, updatedCount };
}

export type LoginResult = { success: true; redirectTo?: string } | { success: false; error: string };

/** Login only: validation + cookie. No DB access, no redirect() — client handles navigation. */
export async function loginWithPassword(password: string): Promise<LoginResult> {
  // Validation only — no redirect() in action; redirect in try/catch causes hang in Next.js 15
  if (!password || typeof password !== 'string') {
    return { success: false, error: 'Password is required.' };
  }
  const adminPassword = process.env.ADMIN_LOGIN_PASSWORD;
  if (!adminPassword) {
    return { success: false, error: 'Authentication is not configured. Set ADMIN_LOGIN_PASSWORD.' };
  }
  if (!isSessionEnabled()) {
    return { success: false, error: 'Session is not configured. Set APP_SESSION_SECRET.' };
  }
  if (password.trim() !== adminPassword) {
    return { success: false, error: 'Invalid credentials.' };
  }

  try {
    const token = createSessionToken('admin');
    const jar = await cookies();
    const isProduction = process.env.NODE_ENV === 'production';
    const headersList = await headers();
    const host = headersList.get('host') || '';

    const cookieOptions: Parameters<ReturnType<typeof cookies>['set']>[2] = {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12,
    };
    if (isProduction && host.includes('moncherigroup.co.il')) {
      cookieOptions.domain = '.moncherigroup.co.il';
    }

    jar.set('app_auth_token', token, cookieOptions);
    console.log('[auth] login success, app_auth_token set');
  } catch (err) {
    const d = err && typeof err === 'object' && 'digest' in err ? (err as { digest?: string }).digest : undefined;
    if (typeof d === 'string' && d.startsWith('NEXT_REDIRECT')) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Login failed. Try again.';
    return { success: false, error: message };
  }

  return { success: true, redirectTo: '/ops' };
}

export async function logout(): Promise<{ success: true }> {
  try {
    const jar = await cookies();
    const isProduction = process.env.NODE_ENV === 'production';
    const headersList = await headers();
    const host = headersList.get('host') || '';
    const opts: Parameters<ReturnType<typeof cookies>['set']>[2] = {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    };
    if (isProduction && host.includes('moncherigroup.co.il')) {
      opts.domain = '.moncherigroup.co.il';
    }
    jar.set('app_auth_token', '', opts);
  } catch {
    // Ignore cookie clear errors
  }
  return { success: true };
}
