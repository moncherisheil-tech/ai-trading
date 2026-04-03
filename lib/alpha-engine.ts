/**
 * Tri-Core Alpha Matrix — Groq (Hourly / order book), Anthropic (Daily / whales), Gemini (Weekly + Long / macro + memory).
 * ATR-based stop and minimum 1:2 R:R use hardcoded policy constants.
 *
 * Circuit breaker wraps each LLM leg so transient endpoint failures
 * are automatically routed to a Gemini/Groq fallback without dropping the job.
 */
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { withCircuitBreaker } from '@/lib/queue/circuit-breaker';
import { Prisma } from '@prisma/client';
import type { AlphaDirection, AlphaTimeframe } from '@prisma/client';
import { z } from 'zod';
import { APP_CONFIG } from '@/lib/config';
import {
  fetchBinanceOrderBookDepth,
  fetchMacroContext,
  fetchWithBackoff,
  summarizeOrderBookDepth,
} from '@/lib/api-utils';
import { ANTHROPIC_MODEL_CANDIDATES } from '@/lib/anthropic-model';
import { parseAiJsonObject } from '@/lib/ai/parser';
import { getGeminiApiKey, getGroqApiKey, getRequiredAnthropicApiKey } from '@/lib/env';
import {
  GEMINI_CANONICAL_PRO_MODEL_ID,
  resolveGeminiModel,
  withGeminiRateLimitRetry,
} from '@/lib/gemini-model';
import { resolveGroqModel } from '@/lib/groq-model';
import { atr } from '@/lib/indicators';
import { getLeviathanSnapshot } from '@/lib/leviathan';
import { getPrisma } from '@/lib/prisma';
import { getRecentWhaleMovements } from '@/lib/trading/whale-tracker';
import { querySimilarTrades } from '@/lib/vector-db';

/** Hardcoded institutional risk math. */
export const ALPHA_ATR_PERIOD = 14;
export const ALPHA_ATR_SL_MULTIPLIER = 2;
export const ALPHA_MIN_RISK_REWARD_RATIO = 2;

type KlineTuple = [number, string, string, string, string, string];

export const coreSignalSchema = z.object({
  direction: z.enum(['Long', 'Short']),
  winProbability: z.number().min(0).max(100),
  rationaleHebrew: z.string().min(1),
});

const geminiDualSchema = z.object({
  weekly: coreSignalSchema,
  long: coreSignalSchema,
});

/** Weekly + Long Gemini leg — validated JSON shape for Tri-Core Alpha. */
export type AnalysisResult = z.infer<typeof geminiDualSchema>;
export { geminiDualSchema as analysisResultSchema };

/** True when Groq hourly leg returned parsed model JSON (not missing-key or parse fallback). */
export function triCoreGroqOutputIsLlmParsed(r: { rationaleHebrew: string }): boolean {
  const h = r.rationaleHebrew;
  return !h.includes('מפתח חסר') && !h.includes('פלט Groq לא ניתן לפענוח');
}

/** True when Anthropic daily leg returned parsed model JSON (not key/HTTP/parse fallback). */
export function triCoreAnthropicOutputIsLlmParsed(r: { rationaleHebrew: string }): boolean {
  const h = r.rationaleHebrew;
  return (
    !h.includes('Anthropic לא זמין') &&
    !h.includes('שגיאת Anthropic') &&
    !h.includes('פלט Claude לא תקין')
  );
}

/** True when Gemini weekly/long leg returned parsed model JSON (not parse fallback). */
export function triCoreGeminiOutputIsLlmParsed(r: AnalysisResult): boolean {
  const bad = 'פלט Gemini לא תקין';
  return !r.weekly.rationaleHebrew.includes(bad) && !r.long.rationaleHebrew.includes(bad);
}

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<KlineTuple[]> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const response = await fetchWithBackoff(url, { timeoutMs: 14_000, maxRetries: 2, cache: 'no-store' });
  if (!response.ok) return [];
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) return [];
  return payload.filter((row): row is KlineTuple => Array.isArray(row) && row.length >= 6);
}

function atrFromKlines(klines: KlineTuple[], period = ALPHA_ATR_PERIOD): number | null {
  if (klines.length < period + 2) return null;
  const highs = klines.map((k) => Number.parseFloat(k[2]));
  const lows = klines.map((k) => Number.parseFloat(k[3]));
  const closes = klines.map((k) => Number.parseFloat(k[4]));
  return atr(highs, lows, closes, period);
}

function clampProb(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function computeStopTarget(
  entry: number,
  atrVal: number | null,
  direction: AlphaDirection
): { stopLoss: number; targetPrice: number } {
  const floorPct = entry * 0.008;
  const atrPart =
    atrVal != null && Number.isFinite(atrVal) && atrVal > 0 ? atrVal * ALPHA_ATR_SL_MULTIPLIER : floorPct;
  const risk = Math.max(floorPct, atrPart);
  const reward = risk * ALPHA_MIN_RISK_REWARD_RATIO;
  if (direction === 'Long') {
    return { stopLoss: entry - risk, targetPrice: entry + reward };
  }
  return { stopLoss: entry + risk, targetPrice: entry - reward };
}

const RAW_JSON_SYSTEM_EN = [
  'Return ONLY a raw JSON object. No conversational filler, no preamble, no postscript.',
  'DO NOT use markdown or code fences (no ```json, no ```).',
  'No prose before or after the JSON — the entire reply must be parseable as a single JSON value.',
].join(' ');

export async function callGroqHourly(orderBookSummary: string, symbol: string, price: number): Promise<z.infer<typeof coreSignalSchema>> {
  const key = getGroqApiKey();
  if (!key) {
    const bidHeavy = orderBookSummary.includes('Bid-heavy');
    const askHeavy = orderBookSummary.includes('Ask-heavy');
    return {
      direction: askHeavy && !bidHeavy ? 'Short' : 'Long',
      winProbability: 55,
      rationaleHebrew: 'Groq לא זמין — מפתח חסר. ניתוח מבוסס ספר הזמנות בלבד.',
    };
  }
  const groq = new Groq({ apiKey: key });
  const model = resolveGroqModel();
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 4096,
    messages: [
      {
        role: 'system',
        content: [
          'You are a highly accurate, institutional quantitative order-book analyst. Horizon: hourly scalping.',
          'If Bids > Asks (bid-side depth or notional exceeds the ask side), it indicates BUYING pressure — bias Long.',
          'If Asks > Bids (ask-side exceeds bids), it indicates SELLING pressure — bias Short.',
          'Do not invert this relationship.',
          RAW_JSON_SYSTEM_EN,
          'Required JSON keys: direction ("Long" or "Short"), winProbability (0-100), rationaleHebrew (Hebrew string).',
        ].join(' '),
      },
      {
        role: 'user',
        content: `סמל ${symbol}, מחיר ${price}. סיכום ספר הזמנות:\n${orderBookSummary}\n\nקבע הזדמנות סקאלפ שעתית (Hourly). החזר אובייקט JSON גולמי בלבד.`,
      },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
  const jsonTry = parseAiJsonObject(raw, 'Groq hourly (Tri-Core)');
  if (jsonTry.ok) {
    const parsed = coreSignalSchema.safeParse(jsonTry.value);
    if (parsed.success) return parsed.data;
    console.error('[Groq hourly] schema mismatch after JSON parse:', parsed.error.flatten());
  }
  return {
    direction: 'Long',
    winProbability: 52,
    rationaleHebrew: 'פלט Groq לא ניתן לפענוח — מוצג ניטרלי.',
  };
}

export async function callAnthropicDaily(
  leviathanText: string,
  whaleJson: string,
  symbol: string,
  price: number
): Promise<z.infer<typeof coreSignalSchema>> {
  let key: string;
  try {
    key = getRequiredAnthropicApiKey();
  } catch {
    return {
      direction: 'Long',
      winProbability: 53,
      rationaleHebrew: 'Anthropic לא זמין — ניתוח לווייתנים מוגבל לנתוני CryptoQuant בלבד.',
    };
  }
  const systemBlock = [
    'You are an institutional whale-flow analyst for crypto. Daily / swing horizon.',
    RAW_JSON_SYSTEM_EN,
    'JSON keys only: direction ("Long" or "Short"), winProbability (0-100), rationaleHebrew (Hebrew string).',
  ].join(' ');

  const userBlock = `נתח זרימות לווייתנים. החזר רק אובייקט JSON גולמי — ללא markdown, ללא טקסט לפני או אחרי.
מפתחות בלבד: direction ("Long" או "Short"), winProbability (0-100), rationaleHebrew (עברית).
סמל ${symbol}, מחיר ${price}.
Leviathan: ${leviathanText}
WhaleTracker: ${whaleJson}
אופק יומי (Daily / Swing).`;

  let lastStatus = 0;
  let lastErrorText = '';
  let text = '';

  for (const modelId of ANTHROPIC_MODEL_CANDIDATES) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 4096,
        system: systemBlock,
        messages: [{ role: 'user', content: userBlock }],
      }),
      cache: 'no-store',
    });

    lastStatus = res.status;
    if (!res.ok) {
      lastErrorText = await res.text();
      if (res.status === 404) {
        console.error(`[Anthropic] model not found, trying next: ${modelId}`, lastErrorText);
        continue;
      }
      console.error('[ANTHROPIC FATAL ERROR]', res.status, lastErrorText);
      return {
        direction: 'Long',
        winProbability: 51,
        rationaleHebrew: `שגיאת Anthropic (${res.status}) — תרחיש יומי ניטרלי.`,
      };
    }

    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    text = '';
    for (const c of data.content || []) {
      if (c.type === 'text' && c.text) text += c.text;
    }

    const jsonTry = parseAiJsonObject(text || '{}', `Anthropic daily (Tri-Core) model=${modelId}`);
    if (jsonTry.ok) {
      const parsed = coreSignalSchema.safeParse(jsonTry.value);
      if (parsed.success) return parsed.data;
      console.error('[Anthropic daily] schema mismatch after JSON parse:', parsed.error.flatten());
    }
  }

  if (lastStatus && lastStatus !== 404) {
    console.error('[Anthropic] exhausted models; last status', lastStatus, lastErrorText);
  }
  return {
    direction: 'Long',
    winProbability: 50,
    rationaleHebrew: 'פלט Claude לא תקין — מוצג ניטרלי ליומי.',
  };
}

export async function callGeminiWeeklyLong(
  macroLine: string,
  deepMemoryBlock: string,
  symbol: string,
  price: number
): Promise<z.infer<typeof geminiDualSchema>> {
  const apiKey = getGeminiApiKey();
  const primary = process.env.GEMINI_MODEL_PRIMARY || GEMINI_CANONICAL_PRO_MODEL_ID;
  const selected = resolveGeminiModel(primary);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel(
    {
      model: selected.model,
      systemInstruction: [
        'You are an institutional macro and deep-memory analyst for crypto.',
        RAW_JSON_SYSTEM_EN,
        'Emit one JSON object with nested weekly and long objects as specified in the user message.',
      ].join(' '),
    },
    selected.requestOptions
  );
  const prompt = `אתה אנליסט מאקרו ו-Deep Memory.

CRITICAL OUTPUT RULES (repeat for compliance):
- Return RAW JSON only — a single JSON object, nothing else.
- DO NOT use markdown code block wrappers like \`\`\`json or \`\`\`.
- Do not add explanations before or after the JSON.

Schema (example shape only):
{"weekly":{"direction":"Long","winProbability":70,"rationaleHebrew":"טקסט בעברית"},"long":{"direction":"Short","winProbability":65,"rationaleHebrew":"טקסט בעברית"}}

חובה: direction הוא המחרוזת Long או Short בלבד (באנגלית). winProbability מספר 0-100. rationaleHebrew בעברית.
סמל ${symbol}, מחיר ${price}.
מאקרו: ${macroLine}
הקשר Deep Memory (עסקאות דומות): ${deepMemoryBlock}
שבועי=אופק Weekly, long=אופק ארוך (Position).`;

  let rawText = '';
  try {
    const result = await withGeminiRateLimitRetry(() =>
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.25, maxOutputTokens: 4096 },
      })
    );
    rawText = result.response.text() ?? '';
    const jsonTry = parseAiJsonObject(rawText, 'Gemini weekly/long (Tri-Core)');
    if (!jsonTry.ok) {
      /* parseAiJsonObject already logged RAW + cleaned */
    } else {
      const parsed = geminiDualSchema.safeParse(jsonTry.value);
      if (parsed.success) return parsed.data;
      console.error('RAW GEMINI RESPONSE:', rawText);
      console.error('[GEMINI SCHEMA ERROR]', parsed.error);
    }
  } catch (e) {
    console.error('RAW GEMINI RESPONSE:', rawText);
    console.error('[GEMINI REQUEST ERROR]', e);
  }
  const neutral = {
    direction: 'Long' as const,
    winProbability: 54,
    rationaleHebrew: 'פלט Gemini לא תקין — Weekly/Long ניטרליים.',
  };
  return {
    weekly: neutral,
    long: { ...neutral, rationaleHebrew: `${neutral.rationaleHebrew} (ארוך טווח)` },
  };
}

function whaleConfirmationForDirection(
  direction: AlphaDirection,
  leviathanOk: boolean,
  netFlowUsd: number | null
): boolean {
  if (!leviathanOk) return false;
  if (netFlowUsd == null || !Number.isFinite(netFlowUsd)) return true;
  if (direction === 'Long') return netFlowUsd <= 0;
  return netFlowUsd >= 0;
}

export async function runTriCoreAlphaMatrix(symbol: string): Promise<{ createdIds: string[] }> {
  const prisma = getPrisma();
  if (!prisma) throw new Error('מסד נתונים לא מוגדר (DATABASE_URL).');

  const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pair = clean.endsWith('USDT') ? clean : `${clean}USDT`;
  const baseAsset = pair.endsWith('USDT') ? pair.slice(0, -4) : pair;

  const [klines1h, klines1d, klines1w, depth, leviathan, whaleMv, macro] = await Promise.all([
    fetchKlines(pair, '1h', 120),
    fetchKlines(pair, '1d', 120),
    fetchKlines(pair, '1w', 60),
    fetchBinanceOrderBookDepth(pair, 50, 12_000),
    getLeviathanSnapshot(pair),
    getRecentWhaleMovements(baseAsset),
    fetchMacroContext(),
  ]);

  const closes1h = klines1h.map((k) => Number.parseFloat(k[4]));
  const entry = closes1h.length ? closes1h[closes1h.length - 1]! : 0;
  if (!Number.isFinite(entry) || entry <= 0) {
    throw new Error('לא ניתן לקבל מחיר כניסה חי מהבורסה.');
  }

  const atr1h = atrFromKlines(klines1h);
  const atr1d = atrFromKlines(klines1d);
  const atr1w = atrFromKlines(klines1w);
  const atrLong = atr1w != null && Number.isFinite(atr1w) ? atr1w * 1.25 : atr1d;

  const obSummary = summarizeOrderBookDepth(depth, pair);
  const leviathanOk = leviathan.signals.some((s) => s.ok);
  const netFlow = whaleMv.netExchangeFlowUsd;
  const whaleJson = JSON.stringify({
    status: whaleMv.status,
    netExchangeFlowUsd: whaleMv.netExchangeFlowUsd,
    severeInflows: whaleMv.severeInflowsToExchanges,
  });
  const similar = await querySimilarTrades(pair, 4).catch(() => []);
  const deepMemoryBlock =
    similar.length > 0
      ? similar.map((t) => t.text).join(' | ').slice(0, 2800)
      : 'אין עסקאות דומות ב-Pinecone.';

  const macroLine = `DXY: ${macro.dxyNote}; BTC dom ${macro.btcDominancePct ?? '—'}%; F&G ${macro.fearGreedIndex ?? '—'}`;

  const triCoreLegTimeoutMs = Math.min(180_000, Math.max(45_000, APP_CONFIG.geminiTimeoutMs + 15_000));

  function withLegTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${triCoreLegTimeoutMs}ms`)),
        triCoreLegTimeoutMs
      );
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    }) as Promise<T>;
  }

  /** Isolated try/catch + timeout per leg — failures do not abort sibling Tri-Core experts. */
  async function runTriCoreLeg<T>(label: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      return { ok: true, value: await withLegTimeout(label, fn()) };
    } catch (reason) {
      console.error(`[Tri-Core] ${label} leg failed:`, reason);
      return { ok: false };
    }
  }

  /** Gemini fallback used when Groq or Anthropic circuit breaker is OPEN. */
  async function geminiFallbackHourly(): Promise<z.infer<typeof coreSignalSchema>> {
    const dual = await callGeminiWeeklyLong(macroLine, deepMemoryBlock, pair, entry);
    return { ...dual.weekly, rationaleHebrew: `[CB-Fallback·Groq→Gemini] ${dual.weekly.rationaleHebrew}` };
  }

  async function geminiFallbackDaily(): Promise<z.infer<typeof coreSignalSchema>> {
    const dual = await callGeminiWeeklyLong(macroLine, deepMemoryBlock, pair, entry);
    return { ...dual.long, rationaleHebrew: `[CB-Fallback·Anthropic→Gemini] ${dual.long.rationaleHebrew}` };
  }

  async function groqFallbackWeeklyLong(): Promise<z.infer<typeof geminiDualSchema>> {
    const hourly = await callGroqHourly(obSummary, pair, entry);
    const fallback = { ...hourly, rationaleHebrew: `[CB-Fallback·Gemini→Groq] ${hourly.rationaleHebrew}` };
    return { weekly: fallback, long: fallback };
  }

  const [groqLeg, anthropicLeg, geminiLeg] = await Promise.all([
    runTriCoreLeg('Groq hourly (CB)', () =>
      withCircuitBreaker('groq', () => callGroqHourly(obSummary, pair, entry), geminiFallbackHourly)
    ),
    runTriCoreLeg('Anthropic daily (CB)', () =>
      withCircuitBreaker('anthropic', () => callAnthropicDaily(leviathan.institutionalWhaleContext, whaleJson, pair, entry), geminiFallbackDaily)
    ),
    runTriCoreLeg('Gemini weekly/long (CB)', () =>
      withCircuitBreaker('gemini', () => callGeminiWeeklyLong(macroLine, deepMemoryBlock, pair, entry), groqFallbackWeeklyLong)
    ),
  ]);

  const tfMap: Array<{
    tf: AlphaTimeframe;
    core: z.infer<typeof coreSignalSchema>;
    atrVal: number | null;
  }> = [];

  if (groqLeg.ok) {
    tfMap.push({ tf: 'Hourly', core: groqLeg.value, atrVal: atr1h });
  }
  if (anthropicLeg.ok) {
    tfMap.push({ tf: 'Daily', core: anthropicLeg.value, atrVal: atr1d });
  }
  if (geminiLeg.ok) {
    const dual = geminiLeg.value;
    tfMap.push({ tf: 'Weekly', core: dual.weekly, atrVal: atr1w });
    tfMap.push({ tf: 'Long', core: dual.long, atrVal: atrLong });
  }

  const rows = tfMap.map(({ tf, core, atrVal }) => {
    const direction = core.direction as AlphaDirection;
    const { stopLoss, targetPrice } = computeStopTarget(entry, atrVal, direction);
    const whaleConfirmation = whaleConfirmationForDirection(direction, leviathanOk, netFlow);
    const tag =
      tf === 'Hourly'
        ? '[Groq·שעתי] '
        : tf === 'Daily'
          ? '[Anthropic·יומי] '
          : tf === 'Weekly'
            ? '[Gemini·שבועי] '
            : '[Gemini·ארוך טווח] ';
    const rationaleHebrew = tag + core.rationaleHebrew;
    return {
      symbol: pair,
      timeframe: tf,
      direction,
      entryPrice: new Prisma.Decimal(entry.toFixed(8)),
      targetPrice: new Prisma.Decimal(targetPrice.toFixed(8)),
      stopLoss: new Prisma.Decimal(stopLoss.toFixed(8)),
      winProbability: clampProb(core.winProbability),
      whaleConfirmation,
      rationaleHebrew,
      status: 'Active' as const,
    };
  });

  if (rows.length === 0) {
    return { createdIds: [] };
  }

  const replacedTimeframes = rows.map((r) => r.timeframe);

  const createdIds = await prisma.$transaction(async (tx) => {
    await tx.alphaSignalRecord.updateMany({
      where: { symbol: pair, status: 'Active', timeframe: { in: replacedTimeframes } },
      data: { status: 'Expired' },
    });
    await tx.alphaSignalRecord.createMany({ data: rows });
    const latest = await tx.alphaSignalRecord.findMany({
      where: { symbol: pair, status: 'Active' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, timeframe: true },
    });
    const want = new Set<AlphaTimeframe>(replacedTimeframes);
    const picked: string[] = [];
    for (const r of latest) {
      if (want.has(r.timeframe) && !picked.includes(r.id)) {
        picked.push(r.id);
        want.delete(r.timeframe);
      }
    }
    return picked;
  });

  return { createdIds };
}
