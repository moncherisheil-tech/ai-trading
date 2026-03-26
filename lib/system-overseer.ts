/**
 * System Overseer (Virtual COO) — cohesion analysis and context for CEO chat.
 * Evaluates divergence between Tech, Risk, Psych scores; flags Market Uncertainty and suggests MoE threshold.
 * Provides getSystemContextForChat() for Web and Telegram Executive Hotline.
 */

import { getAppSettings, DEFAULT_MOE_THRESHOLD } from '@/lib/db/app-settings';
import { listOpenVirtualTrades } from '@/lib/db/virtual-portfolio';
import { computePortfolioAllocation } from '@/lib/portfolio-math';
import { getVirtualPortfolioSummary } from '@/lib/simulation-service';
import { fetchBinanceTickerPrices } from '@/lib/api-utils';
import { APP_CONFIG } from '@/lib/config';
import { toDecimal, round2 } from '@/lib/decimal';
import type { Locale } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/locale.server';

const REF_LIQUID_USD = 10_000;

/** Expert scores from ConsensusEngine (Tech, Risk, Psych). */
export interface ExpertsData {
  tech_score: number;
  risk_score: number;
  psych_score: number;
}

/** Result of cohesion evaluation: variance high → Market Uncertainty, suggested MoE bump. */
export interface SystemCohesionResult {
  /** True when variance between experts is high (e.g. std dev > threshold). */
  marketUncertainty: boolean;
  /** Suggested MoE confidence threshold to use (base + bump when uncertain). */
  suggestedMoeThreshold: number;
  /** Human-readable status for UI. */
  statusHe: string;
  /** Variance (e.g. population variance of the three scores). */
  variance: number;
}

const VARIANCE_THRESHOLD = 400; // ~20 pt spread: (80,50,70) → variance ~167; (90,30,60) → 600
const UNCERTAINTY_MOE_BUMP = 5; // Raise threshold by 5 when uncertain (e.g. 75 → 80)

/**
 * Evaluates divergence between Tech, Risk, and Psych scores.
 * If variance is high, flags "Market Uncertainty" and suggests raising the MoE threshold.
 * Hook this into ConsensusEngine so it can use suggestedMoeThreshold when marketUncertainty is true.
 */
/** Safe number for expert score; handles missing/NaN. */
function safeScore(v: number | undefined | null): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
}

export function evaluateSystemCohesion(expertsData: ExpertsData): SystemCohesionResult {
  const tech = safeScore(expertsData.tech_score);
  const risk = safeScore(expertsData.risk_score);
  const psych = safeScore(expertsData.psych_score);
  const mean = (tech + risk + psych) / 3;
  const variance =
    (Math.pow(tech - mean, 2) + Math.pow(risk - mean, 2) + Math.pow(psych - mean, 2)) / 3;
  const varianceNum = Number.isFinite(variance) ? variance : 0;
  const marketUncertainty = varianceNum >= VARIANCE_THRESHOLD;
  const baseThreshold = DEFAULT_MOE_THRESHOLD;
  const suggestedMoeThreshold = marketUncertainty
    ? Math.min(95, baseThreshold + UNCERTAINTY_MOE_BUMP)
    : baseThreshold;

  const statusHe = marketUncertainty
    ? 'אִי־וַדָאוּת שוק — מומלץ להעלות סף MoE זמנית'
    : 'צִמְדוּת מערכת תקינה';

  return {
    marketUncertainty,
    suggestedMoeThreshold,
    statusHe,
    variance: round2(varianceNum),
  };
}

/**
 * Async version: reads current MoE from settings and returns suggested threshold when variance is high.
 */
export async function evaluateSystemCohesionAsync(expertsData: ExpertsData): Promise<SystemCohesionResult> {
  const tech = safeScore(expertsData.tech_score);
  const risk = safeScore(expertsData.risk_score);
  const psych = safeScore(expertsData.psych_score);
  const mean = (tech + risk + psych) / 3;
  const variance =
    (Math.pow(tech - mean, 2) + Math.pow(risk - mean, 2) + Math.pow(psych - mean, 2)) / 3;
  const varianceNum = Number.isFinite(variance) ? variance : 0;
  const marketUncertainty = varianceNum >= VARIANCE_THRESHOLD;

  let baseThreshold = DEFAULT_MOE_THRESHOLD;
  try {
    const settings = await getAppSettings();
    baseThreshold = settings.neural.moeConfidenceThreshold ?? DEFAULT_MOE_THRESHOLD;
  } catch {
    // use default
  }
  const suggestedMoeThreshold = marketUncertainty
    ? Math.min(95, baseThreshold + UNCERTAINTY_MOE_BUMP)
    : baseThreshold;

  const statusHe = marketUncertainty
    ? 'אִי־וַדָאוּת שוק — מומלץ להעלות סף MoE זמנית'
    : 'צִמְדוּת מערכת תקינה';

  return {
    marketUncertainty,
    suggestedMoeThreshold,
    statusHe,
    variance: round2(varianceNum),
  };
}

/** Context payload for Overseer chat (Web + Telegram). */
export interface SystemContextForChat {
  globalExposurePct: number;
  todayPnlPct: number;
  currentMoeThreshold: number;
  recentWinRatePct: number;
  openPositionsCount: number;
  closedPositionsCount: number;
  marketUncertaintyFlag: boolean;
  statusHe: string;
  /** From settings: used for UI exposure red/amber (e.g. red when >= this). */
  maxExposurePct?: number;
  /** From settings: used for concentration warning. */
  maxConcentrationPct?: number;
}

/**
 * Fetches real-time context for CEO chat: global exposure, today PnL, MoE threshold, win rate.
 * All metrics from DB: exposure from open virtual trades + Binance prices; win rate and PnL from
 * getVirtualPortfolioSummary (closed trades). Virtual COO must not hallucinate — data is real.
 * Used by both Web Executive Chat and Telegram Executive Hotline.
 */
export async function getSystemContextForChat(): Promise<SystemContextForChat> {
  const defaults: SystemContextForChat = {
    globalExposurePct: 0,
    todayPnlPct: 0,
    currentMoeThreshold: DEFAULT_MOE_THRESHOLD,
    recentWinRatePct: 0,
    openPositionsCount: 0,
    closedPositionsCount: 0,
    marketUncertaintyFlag: false,
    statusHe: 'נתונים לא זמינים',
  };

  if (!APP_CONFIG.postgresUrl?.trim()) {
    try {
      const settings = await getAppSettings();
      defaults.currentMoeThreshold = settings.neural.moeConfidenceThreshold;
    } catch {
      // ignore
    }
    return defaults;
  }

  try {
    const [settings, summary, openTrades] = await Promise.all([
      getAppSettings(),
      getVirtualPortfolioSummary(),
      listOpenVirtualTrades(),
    ]);

    let globalExposurePct = 0;
    if (openTrades.length > 0) {
      try {
        const prices = await fetchBinanceTickerPrices(openTrades.map((t) => t.symbol), 5_000);
        const positions = openTrades.map((t) => {
          const price = prices.get(t.symbol) ?? t.entry_price;
          const entryD = toDecimal(t.entry_price);
          const amountUsdD = toDecimal(t.amount_usd);
          const currentValueUsd =
            entryD.gt(0) ? round2(amountUsdD.times(price).div(entryD)) : t.amount_usd;
          const amountAsset = entryD.gt(0) ? round2(amountUsdD.div(entryD)) : 0;
          return { symbol: t.symbol, currentValueUsd, amountAsset };
        });
        const allocation = computePortfolioAllocation({
          liquidBalanceUsd: REF_LIQUID_USD,
          positions,
        });
        globalExposurePct = round2(allocation.totalExposurePct);
      } catch {
        // leave 0
      }
    }

    return {
      globalExposurePct,
      todayPnlPct: round2(summary.dailyPnlPct),
      currentMoeThreshold: settings.neural.moeConfidenceThreshold ?? DEFAULT_MOE_THRESHOLD,
      recentWinRatePct: round2(summary.winRatePct),
      openPositionsCount: summary.openCount,
      closedPositionsCount: summary.closedCount,
      marketUncertaintyFlag: false, // set by caller if they have experts data
      statusHe: 'מערכת פעילה',
      maxExposurePct: settings.risk.globalMaxExposurePct,
      maxConcentrationPct: settings.risk.singleAssetConcentrationLimitPct,
    };
  } catch (e) {
    console.warn('[SystemOverseer] getSystemContextForChat failed:', e);
    return defaults;
  }
}

/**
 * Build Overseer AI reply for CEO chat (Web + Telegram). Uses Gemini with system context.
 * Returns concise professional Hebrew response focused on risk and status.
 */
export async function getOverseerChatReply(userMessage: string, locale?: Locale): Promise<string> {
  const outputLocale = locale ?? await getRequestLocale();
  const isHebrew = outputLocale === 'he';
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const { getGeminiApiKey } = await import('@/lib/env');
  const { APP_CONFIG } = await import('@/lib/config');

  const context = await getSystemContextForChat();
  const dataBlob = JSON.stringify(
    {
      globalExposurePct: context.globalExposurePct,
      todayPnlPct: context.todayPnlPct,
      currentMoeThreshold: context.currentMoeThreshold,
      recentWinRatePct: context.recentWinRatePct,
      openPositions: context.openPositionsCount,
      closedPositions: context.closedPositionsCount,
      statusHe: context.statusHe,
    },
    null,
    2
  );

  const systemInstruction = `You are the System Overseer (Virtual COO) of Smart Money. Current system data:
${dataBlob}

Answer the CEO's message concisely in professional ${isHebrew ? 'Hebrew' : 'English'}, focusing on risk and status. Be brief (2-4 sentences). No markdown, no code blocks.`;

  const apiKey = getGeminiApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  const timeoutMs = Math.min(15_000, APP_CONFIG.geminiTimeoutMs ?? 60_000);

  const model = genAI.getGenerativeModel({ model: APP_CONFIG.primaryModel || 'gemini-2.0-flash' });
  const res = await Promise.race([
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\nMessage from CEO: ${userMessage}` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
    }),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('Overseer chat timeout')), timeoutMs)
    ),
  ]);

  let text: string;
  try {
    text = (res.response.text() ?? '').trim();
  } catch {
    text = '';
  }
  return text || (isHebrew ? 'לא התקבלה תשובה מהמערכת. נסה שוב.' : 'No response received from the system. Please try again.');
}

/**
 * CIO-style daily summary for Hedge Fund Pulse.
 * One concise English sentence for professional investors.
 */
export async function getDailyCioSummary(locale?: Locale): Promise<string> {
  const outputLocale = locale ?? await getRequestLocale();
  const isHebrew = outputLocale === 'he';
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const { getGeminiApiKey } = await import('@/lib/env');
  const { APP_CONFIG } = await import('@/lib/config');

  const context = await getSystemContextForChat();
  const dataBlob = JSON.stringify(
    {
      globalExposurePct: context.globalExposurePct,
      todayPnlPct: context.todayPnlPct,
      currentMoeThreshold: context.currentMoeThreshold,
      recentWinRatePct: context.recentWinRatePct,
      openPositions: context.openPositionsCount,
      closedPositions: context.closedPositionsCount,
      status: context.statusHe,
    },
    null,
    2
  );

  const systemInstruction = `You are the CIO of Mon Chéri Quant hedge fund. Current system data:
${dataBlob}

Write a single ${isHebrew ? 'Hebrew' : 'English'} sentence (max 30 words) summarizing today's trading and risk posture for sophisticated hedge fund investors. Do not use markdown or quotes. Neutral, institutional tone.`;

  const apiKey = getGeminiApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  const timeoutMs = Math.min(10_000, APP_CONFIG.geminiTimeoutMs ?? 60_000);

  const model = genAI.getGenerativeModel({
    model: APP_CONFIG.primaryModel || 'gemini-2.0-flash',
  });

  const res = await Promise.race([
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\nProvide today’s CIO summary.` }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 80 },
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Overseer CIO timeout')), timeoutMs)),
  ]);

  let text: string;
  try {
    text = (res.response.text() ?? '').trim();
  } catch {
    text = '';
  }
  return text || (isHebrew ? 'אין סיכום CIO זמין להיום.' : 'No CIO summary available for today.');
}

