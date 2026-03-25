'use server';

/** Long-running analyzeCrypto relies on page route maxDuration (e.g. app/page.tsx export const maxDuration = 60). */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDbAsync, saveDbAsync, PredictionRecord, SourceCitation } from '@/lib/db';
import { getGeminiApiKey } from '@/lib/env';
import { APP_CONFIG, shouldUseSecureCookies } from '@/lib/config';
import { allowRequest } from '@/lib/rate-limit';
import { allowDistributedRequest } from '@/lib/rate-limit-distributed';
import { aiPredictionSchema, aiPredictionPartialSchema, binanceKlinesSchema, fearGreedSchema, sourceCitationSchema } from '@/lib/schemas';
import { listStrategyInsights, updateStrategyInsightStatus } from '@/lib/db/strategy-repository';
import { z } from 'zod';
import { cookies, headers } from 'next/headers';
import { writeAudit } from '@/lib/audit';
import { enqueueByKey } from '@/lib/task-queue';
import { createSessionToken, hasRequiredRole, isSessionEnabled, verifySessionToken, type SessionRole } from '@/lib/session';
import { evaluatePredictionOutcome } from '@/lib/agents/backtester';
import { getBacktestRepository } from '@/lib/db/backtest-repository';
import { getMarketSentiment, checkSentimentGuardrail } from '@/lib/agents/news-agent';
import {
  computePSuccess,
  computeRSI,
  getRiskLevelHe,
  buildHebrewReport,
} from '@/lib/prediction-formula';
import { appendHistoricalPrediction } from '@/lib/db/historical-predictions';
import { sendTelegramMessage, sendGemAlert } from '@/lib/telegram';
import { isSupportedBase } from '@/lib/symbols';
import { doAnalysisCore } from '@/lib/analysis-core';
import { DEFAULT_MOE_THRESHOLD } from '@/lib/db/app-settings';
import type { SimulationResult, LoginResult, BinanceKline } from '@/lib/actions-types';

interface BinanceTickerPrice {
  symbol?: string;
  price: string;
}

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
    const reason = !token
      ? 'missing_token'
      : !session
        ? 'invalid_or_expired_token'
        : 'insufficient_role';
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[Auth] Unauthorized request:', reason, 'requiredRole=', requiredRole);
    }
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

/** Thrown when upstream returns 451 (e.g. region block). Message includes "451" for detection. */
const ERROR_451_MESSAGE = 'Request failed (451) for upstream API.';

/** User-facing message when Gemini daily quota is exhausted (429). */
const QUOTA_EXHAUSTED_MESSAGE_HE =
  'מכסת ה-AI היומית מוצתה. המערכת תתאפס בקרוב, או שנדרש עדכון חבילת חיוב.';

async function fetchJson<T>(url: string, cache: RequestCache = 'no-store', schema?: z.ZodType<T>): Promise<T> {
  const parsedUrl = new URL(url);
  if (!APP_CONFIG.trustedApiOrigins.includes(parsedUrl.origin)) {
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
      const msg = res.status === 451 ? ERROR_451_MESSAGE : `Request failed (${res.status}) for upstream API.`;
      throw new Error(msg);
    }

    const payload = (await res.json()) as unknown;
    return schema ? schema.parse(payload) : (payload as T);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Logs Zod error details to console for Vercel Logs (path + message per issue).
 */
function logZodError(err: z.ZodError): void {
  for (const issue of err.errors) {
    const path = issue.path.length ? issue.path.join('.') : '(root)';
    console.error(`[Zod] path=${path} message=${issue.message}`);
  }
}

export async function runCryptoAnalysisCore(
  rawSymbol: string,
  options?: { skipCache?: boolean }
): Promise<SimulationResult> {
  try {
    const cleanSymbol = normalizeSymbol((rawSymbol || '').trim());
    const base = cleanSymbol.replace(/USDT$/i, '');
    if (!isSupportedBase(base)) {
      return { success: false, error: 'מטבע לא נתמך. בחר מתוך רשימת המטבעות הזמינים.' };
    }
    return await doAnalysisCore(cleanSymbol, Date.now(), !options?.skipCache);
  } catch (error: unknown) {
    const requestId = crypto.randomUUID();
    const isZod = error instanceof z.ZodError;
    if (isZod) logZodError(error as z.ZodError);
    const err = error instanceof Error ? error.message : 'Analysis failed.';
    const isQuota = err === 'QUOTA_EXHAUSTED_429' || /429|RESOURCE_EXHAUSTED|quota/i.test(String(err));
    const userMessage = isQuota
      ? QUOTA_EXHAUSTED_MESSAGE_HE
      : err === 'DATA_UNAVAILABLE_451' || String(err).includes('451')
        ? 'מתחבר לשרת גיבוי... חסימת אזור. הגדר PROXY_BINANCE_URL לשרת גיבוי או נסה שוב.'
        : isZod
          ? 'שגיאה באימות הנתונים. נסה שוב.'
          : err;
    writeAudit({ event: 'analysis.failed', level: 'warn', meta: { requestId, errorType: error instanceof Error ? error.constructor.name : 'Unknown', quotaExhausted: isQuota } });
    return { success: false, error: userMessage, requestId, ...(isQuota && { quotaExhausted: true }) };
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
    const msg = error instanceof Error ? error.message : String(error);
    if (process.env.NODE_ENV === 'development') {
      console.error('[Analysis] Route failed:', {
        message: msg,
        name: error instanceof Error ? error.constructor?.name : 'Unknown',
        symbol: inputSymbol,
      });
    } else {
      console.error('[Analysis] Route failed:', { message: msg, symbol: inputSymbol });
    }
    if (msg === 'Unauthorized request.') {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[Analysis] Unauthorized: token missing, expired, or insufficient role.');
      }
      return { success: false, error: 'Unauthorized request.' };
    }
    const requestId = crypto.randomUUID();
    const errorType = error instanceof Error ? error.constructor?.name : 'UnknownError';
    const isQuota = msg === 'QUOTA_EXHAUSTED_429' || /429|RESOURCE_EXHAUSTED|quota/i.test(msg);
    const isAiEngineDown = msg === 'AI_ENGINE_ERROR';
    const userMessage = isAiEngineDown
      ? 'מנוע הניתוח בתחזוקה זמנית — נתוני השוק והמסחר ממשיכים לעבוד כרגיל.'
      : isQuota
        ? QUOTA_EXHAUSTED_MESSAGE_HE
        : msg || 'Analysis failed. Please try again.';
    writeAudit({ event: 'analysis.failed', level: 'warn', meta: { requestId, errorType, quotaExhausted: isQuota, aiEngineError: isAiEngineDown, message: msg } });
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[Analysis] Failed:', requestId, errorType, msg);
    }
    return { success: false, error: userMessage, requestId, ...(isQuota && { quotaExhausted: true }), ...(isAiEngineDown && { aiEngineDown: true }) };
  }
  });
}

export async function getHistory() {
  try {
    await requireAuth('viewer');
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized request.') {
      return [];
    }
    throw err;
  }
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

  let genAI: GoogleGenerativeAI;
  try {
    genAI = new GoogleGenerativeAI(getGeminiApiKey());
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Gemini API key is missing or invalid.';
    return { success: false, error: msg };
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

        const evaluatedAt = new Date().toISOString();
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
          evaluated_at: evaluatedAt,
          sentiment_score: record.sentiment_score,
          market_narrative: record.market_narrative,
        });
        await appendHistoricalPrediction({
          prediction_id: record.id,
          symbol: record.symbol,
          prediction_date: record.prediction_date,
          predicted_direction: record.predicted_direction,
          entry_price: record.entry_price,
          actual_price: currentPrice,
          price_diff_pct: priceDiffPct,
          absolute_error_pct: absoluteErrorPct,
          target_percentage: record.target_percentage ?? null,
          probability: record.probability ?? null,
          outcome_label: outcomeLabel,
          requires_deep_analysis: requiresDeepAnalysis,
          evaluated_at: evaluatedAt,
          sentiment_score: record.sentiment_score,
          market_narrative: record.market_narrative,
          bottom_line_he: record.bottom_line_he ?? null,
          risk_level_he: record.risk_level_he ?? null,
          forecast_24h_he: record.forecast_24h_he ?? null,
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

          const model = genAI.getGenerativeModel({ model: APP_CONFIG.primaryModel || 'gemini-2.5-flash' });
          const geminiPromise = model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 },
          });
          const timeoutMs = APP_CONFIG.geminiTimeoutMs ?? 60_000;
          const response = await Promise.race([
            geminiPromise,
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error('Gemini request timeout')), timeoutMs)),
          ]);

          try {
            record.error_report = response.response.text() || "Failed to generate learning note.";
          } catch {
            record.error_report = "Failed to generate learning note.";
          }
        } else {
          record.error_report = "התחזית הייתה נכונה. הדפוס אומת בהצלחה.";
        }

        record.status = 'evaluated';
        updatedCount++;
      } catch (err) {
        const isTimeout = err instanceof Error && (err.message === 'Gemini request timeout' || err.message.includes('timeout'));
        if (isTimeout) {
          record.error_report = "לא ניתן ליצור הערת למידה (תם הזמן).";
          record.status = 'evaluated';
          updatedCount++;
        }
        writeAudit({ event: 'evaluation.record_failed', level: 'warn', meta: { symbol: record.symbol, reason: isTimeout ? 'timeout' : 'error' } });
      }
    }
  }

  if (updatedCount > 0) {
    await saveDbAsync(db);
    writeAudit({ event: 'evaluation.success', meta: { updatedCount } });
  }

  return { success: true, updatedCount };
}

/** Login only: validation + cookie. No redirect() — client uses window.location. */
export async function loginWithPassword(password: string): Promise<LoginResult> {
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
    const secureCookies = shouldUseSecureCookies();
    const host = (await headers()).get('host') || '';
    const domain = host.includes('moncherigroup.co.il') ? '.moncherigroup.co.il' : undefined;

    jar.set('app_auth_token', token, {
      domain,
      secure: secureCookies,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });
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
    const secureCookies = shouldUseSecureCookies();
    const host = (await headers()).get('host') || '';
    const domain = host.includes('moncherigroup.co.il') ? '.moncherigroup.co.il' : undefined;
    jar.set('app_auth_token', '', {
      domain,
      secure: secureCookies,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  } catch {
    // Ignore cookie clear errors
  }
  return { success: true };
}

/** System status for the Live Scanning Worker (settings dashboard). Merges DB settings with in-memory state. */
export async function getScannerStatus(): Promise<{
  lastScanTime: string | null;
  gemsFoundToday: number;
  status: 'ACTIVE' | 'IDLE';
  lastRunStats: { coinsChecked: number; gemsFound: number; alertsSent: number } | null;
  scanner_is_active: boolean;
}> {
  try {
    await requireAuth('viewer');
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized request.') {
      return { lastScanTime: null, gemsFoundToday: 0, status: 'IDLE', lastRunStats: null, scanner_is_active: true };
    }
    throw err;
  }
  const [settings, scanner, gemsFoundToday] = await Promise.all([
    import('@/lib/db/system-settings').then((m) => m.getScannerSettings()),
    Promise.resolve((await import('@/lib/workers/market-scanner')).getScannerState()),
    import('@/lib/db/scanner-alert-log').then((m) => m.countScannerAlertsToday()),
  ]);
  const scanner_is_active = settings?.scanner_is_active ?? true;
  const lastScanTime =
    settings?.last_scan_timestamp != null
      ? new Date(settings.last_scan_timestamp).toISOString()
      : scanner.lastScanTime;
  return {
    lastScanTime,
    gemsFoundToday,
    status: scanner.status,
    lastRunStats: scanner.lastRunStats,
    scanner_is_active,
  };
}

/** Macro Pulse: Fear & Greed, BTC dominance, active threshold (for settings widget). */
export async function getMacroStatus(): Promise<{
  fearGreedIndex: number;
  fearGreedClassification: string;
  btcDominancePct: number;
  macroSentimentScore: number;
  minimumConfidenceThreshold: number;
  strategyLabelHe: string;
}> {
  try {
    await requireAuth('viewer');
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized request.') {
      return {
        fearGreedIndex: 50,
        fearGreedClassification: 'Neutral',
        btcDominancePct: 0,
        macroSentimentScore: 0,
        minimumConfidenceThreshold: DEFAULT_MOE_THRESHOLD,
        strategyLabelHe: '—',
      };
    }
    throw err;
  }
  const { getMacroPulse } = await import('@/lib/macro-service');
  return getMacroPulse();
}

/** Strategy dashboard: weights, last auto-tune, weight-change log, accuracy by confidence (for settings). */
export async function getStrategyDashboard(): Promise<{
  weights: { volume: number; rsi: number; sentiment: number };
  lastAutoTuneAt: string | null;
  weightChangeLog: Array<{ id: number; created_at: string; reason_he: string; volume_weight: number; rsi_weight: number; sentiment_weight: number }>;
  accuracyByConfidence: Array<{ bucket: string; confidence_min: number; confidence_max: number; total: number; hits: number; success_rate_pct: number }>;
}> {
  try {
    await requireAuth('viewer');
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized request.') {
      return {
        weights: { volume: 0.4, rsi: 0.3, sentiment: 0.3 },
        lastAutoTuneAt: null,
        weightChangeLog: [],
        accuracyByConfidence: [],
      };
    }
    throw err;
  }
  const { getWeights, getLastAutoTuneAt, getWeightChangeLog } = await import('@/lib/db/prediction-weights');
  const { getAccuracyByConfidenceBucket } = await import('@/lib/db/historical-predictions');
  const [weights, lastAutoTuneAt, weightChangeLog, accuracyByConfidence] = await Promise.all([
    getWeights(),
    getLastAutoTuneAt(),
    getWeightChangeLog(15),
    getAccuracyByConfidenceBucket(100),
  ]);
  return {
    weights,
    lastAutoTuneAt,
    weightChangeLog,
    accuracyByConfidence,
  };
}
