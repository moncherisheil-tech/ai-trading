/**
 * Tri-Core Alpha Matrix — Groq (Hourly / order book), Anthropic (Daily / whales), Gemini (Weekly + Long / macro + memory).
 * ATR-based stop and minimum 1:2 R:R use hardcoded policy constants.
 */
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
import { ANTHROPIC_SONNET_MODEL } from '@/lib/anthropic-model';
import { getGeminiApiKey, getGroqApiKey, getRequiredAnthropicApiKey } from '@/lib/env';
import { resolveGeminiModel, withGeminiRateLimitRetry } from '@/lib/gemini-model';
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

const coreSignalSchema = z.object({
  direction: z.enum(['Long', 'Short']),
  winProbability: z.number().min(0).max(100),
  rationaleHebrew: z.string().min(1),
});

const geminiDualSchema = z.object({
  weekly: coreSignalSchema,
  long: coreSignalSchema,
});

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

function stripJsonFence(s: string): string {
  let t = s.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  return t;
}

async function callGroqHourly(orderBookSummary: string, symbol: string, price: number): Promise<z.infer<typeof coreSignalSchema>> {
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
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 512,
    messages: [
      {
        role: 'system',
        content:
          'אתה אנליסט ספר הזמנות. החזר JSON בלבד עם המפתחות: direction ("Long" או "Short"), winProbability (מספר 0-100), rationaleHebrew (מחרוזת בעברית). ללא markdown.',
      },
      {
        role: 'user',
        content: `סמל ${symbol}, מחיר ${price}. סיכום ספר הזמנות:\n${orderBookSummary}\n\nקבע הזדמנות סקאלפ שעתית (Hourly). JSON בלבד.`,
      },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content?.trim() || '{}';
  try {
    const parsed = coreSignalSchema.safeParse(JSON.parse(stripJsonFence(raw)));
    if (parsed.success) return parsed.data;
  } catch {
    /* fall through */
  }
  return {
    direction: 'Long',
    winProbability: 52,
    rationaleHebrew: 'פלט Groq לא ניתן לפענוח — מוצג ניטרלי.',
  };
}

async function callAnthropicDaily(
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
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_SONNET_MODEL,
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: `אתה אנליסט זרימות לווייתנים. החזר JSON בלבד: direction ("Long" או "Short"), winProbability (0-100), rationaleHebrew (עברית).
סמל ${symbol}, מחיר ${price}.
Leviathan: ${leviathanText}
WhaleTracker: ${whaleJson}
אופק יומי (Daily / Swing).`,
        },
      ],
    }),
    cache: 'no-store',
  });
  if (!res.ok) {
    return {
      direction: 'Long',
      winProbability: 51,
      rationaleHebrew: `שגיאת Anthropic (${res.status}) — תרחיש יומי ניטרלי.`,
    };
  }
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
  let text = '';
  for (const c of data.content || []) {
    if (c.type === 'text' && c.text) text += c.text;
  }
  try {
    const parsed = coreSignalSchema.safeParse(JSON.parse(stripJsonFence(text || '{}')));
    if (parsed.success) return parsed.data;
  } catch {
    /* fall through */
  }
  return {
    direction: 'Long',
    winProbability: 50,
    rationaleHebrew: 'פלט Claude לא תקין — מוצג ניטרלי ליומי.',
  };
}

async function callGeminiWeeklyLong(
  macroLine: string,
  deepMemoryBlock: string,
  symbol: string,
  price: number
): Promise<z.infer<typeof geminiDualSchema>> {
  const apiKey = getGeminiApiKey();
  const primary = process.env.GEMINI_MODEL_PRIMARY || 'gemini-3-flash-preview';
  const selected = resolveGeminiModel(primary);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: selected.model }, selected.requestOptions);
  const prompt = `אתה אנליסט מאקרו ו-Deep Memory. החזר JSON תקף בלבד, ללא markdown, עם המבנה:
{"weekly":{"direction":"Long","winProbability":70,"rationaleHebrew":"טקסט בעברית"},"long":{"direction":"Short","winProbability":65,"rationaleHebrew":"טקסט בעברית"}}
חובה: direction הוא המחרוזת Long או Short בלבד (באנגלית). winProbability מספר 0-100. rationaleHebrew בעברית.
סמל ${symbol}, מחיר ${price}.
מאקרו: ${macroLine}
הקשר Deep Memory (עסקאות דומות): ${deepMemoryBlock}
שבועי=אופק Weekly, long=אופק ארוך (Position). rationaleHebrew בעברית בלבד. ללא markdown.`;

  const result = await withGeminiRateLimitRetry(() =>
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 1024 },
    })
  );
  const raw = result.response.text();
  try {
    const parsed = geminiDualSchema.safeParse(JSON.parse(stripJsonFence(raw)));
    if (parsed.success) return parsed.data;
  } catch {
    /* fall through */
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

  const triCoreSettled = await Promise.allSettled([
    callGroqHourly(obSummary, pair, entry),
    callAnthropicDaily(leviathan.institutionalWhaleContext, whaleJson, pair, entry),
    callGeminiWeeklyLong(macroLine, deepMemoryBlock, pair, entry),
  ]);

  const tfMap: Array<{
    tf: AlphaTimeframe;
    core: z.infer<typeof coreSignalSchema>;
    atrVal: number | null;
  }> = [];

  const groqResult = triCoreSettled[0];
  if (groqResult.status === 'fulfilled') {
    tfMap.push({ tf: 'Hourly', core: groqResult.value, atrVal: atr1h });
  } else {
    console.error('[Tri-Core] Groq hourly leg failed:', groqResult.reason);
  }

  const anthropicResult = triCoreSettled[1];
  if (anthropicResult.status === 'fulfilled') {
    tfMap.push({ tf: 'Daily', core: anthropicResult.value, atrVal: atr1d });
  } else {
    console.error('[Tri-Core] Anthropic daily leg failed:', anthropicResult.reason);
  }

  const geminiResult = triCoreSettled[2];
  if (geminiResult.status === 'fulfilled') {
    const dual = geminiResult.value;
    tfMap.push({ tf: 'Weekly', core: dual.weekly, atrVal: atr1w });
    tfMap.push({ tf: 'Long', core: dual.long, atrVal: atrLong });
  } else {
    console.error('[Tri-Core] Gemini weekly/long leg failed:', geminiResult.reason);
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
