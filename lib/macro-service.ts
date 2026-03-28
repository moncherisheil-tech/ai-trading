/**
 * Macro Pulse: global sentiment engine (Fear & Greed, BTC Dominance).
 * Used to adjust trading thresholds and for the Executive Morning Report.
 * All labels in professional Hebrew. Use "הנהלה", "אלגוריתם ה-AI" — no personal names.
 */

import { fetchForexUplink } from '@/lib/api-utils';

const FNG_URL = 'https://api.alternative.me/fng/?limit=1';
const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global';
const FETCH_TIMEOUT_MS = 8_000;

export interface MacroPulseResult {
  fearGreedIndex: number;
  fearGreedClassification: string;
  btcDominancePct: number;
  macroSentimentScore: number;
  minimumConfidenceThreshold: number;
  strategyLabelHe: string;
  /** DXY / EURUSD / USDILS + Hebrew note for ILS localization risk. */
  forexUplink?: {
    dxy?: number;
    eurUsd?: number;
    usdIls?: number;
    ilsRiskNoteHe: string;
  };
}

function ilsRiskNoteHe(usdIls?: number): string {
  if (usdIls == null || !Number.isFinite(usdIls)) {
    return 'שער USD/ILS לא זמין — הערכת סיכון מקומית ניטרלית.';
  }
  if (usdIls >= 3.72) return 'דולר חזק מול השקל — עלות המרה לנכסים בדולר גבוהה יותר בש"ח.';
  if (usdIls <= 3.48) return 'שקל חזק מול הדולר — סיכון מרות להמרות מקומיות.';
  return 'שער USD/ILS בטווח מאוזן — סיכון המרה מתון.';
}

/** Safe fallback when macro fetch or DB override path fails unexpectedly. */
export const DEFAULT_MACRO: MacroPulseResult = {
  fearGreedIndex: 50,
  fearGreedClassification: 'Neutral',
  btcDominancePct: 50,
  macroSentimentScore: 50,
  minimumConfidenceThreshold: 80,
  strategyLabelHe: 'סטנדרטי — סף כניסה 80%',
};

/** Standard: 80%. Extreme Fear (< 25): 90%. Extreme Greed (> 75): 85%. */
export function getMinimumConfidenceThreshold(fearGreedIndex: number): number {
  if (fearGreedIndex < 25) return 90;
  if (fearGreedIndex > 75) return 85;
  return 80;
}

export function getActiveStrategyLabelHe(fearGreedIndex: number): string {
  const threshold = getMinimumConfidenceThreshold(fearGreedIndex);
  if (fearGreedIndex < 25) return `שמרנית — סף כניסה ${threshold}% (פחד קיצוני בשוק)`;
  if (fearGreedIndex > 75) return `זהירה — סף כניסה ${threshold}% (תאוות יתר בשוק)`;
  return `סטנדרטי — סף כניסה ${threshold}%`;
}

async function fetchFearGreed(): Promise<{ value: number; classification: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(FNG_URL, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { value: 50, classification: 'Neutral' };
    const data = (await res.json()) as { data?: Array<{ value?: string; value_classification?: string }> };
    const first = data?.data?.[0];
    if (!first) return { value: 50, classification: 'Neutral' };
    const value = Math.max(0, Math.min(100, parseInt(first.value ?? '50', 10) || 50));
    return { value, classification: first.value_classification ?? 'Neutral' };
  } catch {
    clearTimeout(timeout);
    return { value: 50, classification: 'Neutral' };
  }
}

async function fetchBtcDominance(): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(COINGECKO_GLOBAL_URL, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return 50;
    const data = (await res.json()) as { data?: { market_cap_percentage?: { btc?: number } } };
    const pct = data?.data?.market_cap_percentage?.btc;
    if (typeof pct !== 'number') return 50;
    return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  } catch {
    clearTimeout(timeout);
    return 50;
  }
}

/**
 * Unified macro sentiment score 0–100: blend of Fear & Greed (0–100) and inverse of BTC dominance
 * (high dominance => risk-off, lower score). Simple average for clarity.
 * Score 0 = extreme fear / risk-off, 100 = extreme greed / risk-on.
 */
function computeMacroSentimentScore(fearGreedIndex: number, btcDominancePct: number): number {
  const fngNorm = fearGreedIndex;
  const dominanceNorm = 100 - btcDominancePct;
  return Math.round((fngNorm * 0.7 + dominanceNorm * 0.3) * 10) / 10;
}

/** Label for manual strategy override (הנהלה). */
function getStrategyLabelForOverride(thresholdPct: number): string {
  return `ידני (הנהלה) — סף כניסה ${thresholdPct}%`;
}

/**
 * Fetches Fear & Greed and BTC Dominance, computes unified score and active threshold.
 * If a manual strategy override is set in system_configs, it takes precedence.
 */
export async function getMacroPulse(): Promise<MacroPulseResult> {
  try {
    const { getStrategyOverride } = await import('@/lib/db/prediction-weights');
    const override = await getStrategyOverride();
    if (override != null && Number.isFinite(override)) {
      const [fng, btcDom, fx] = await Promise.all([fetchFearGreed(), fetchBtcDominance(), fetchForexUplink(FETCH_TIMEOUT_MS)]);
      const macroSentimentScore = computeMacroSentimentScore(fng.value, btcDom);
      return {
        fearGreedIndex: fng.value,
        fearGreedClassification: fng.classification,
        btcDominancePct: btcDom,
        macroSentimentScore,
        minimumConfidenceThreshold: override,
        strategyLabelHe: getStrategyLabelForOverride(override),
        forexUplink: {
          dxy: fx.dxy,
          eurUsd: fx.eurUsd,
          usdIls: fx.usdIls,
          ilsRiskNoteHe: ilsRiskNoteHe(fx.usdIls),
        },
      };
    }

    const [fng, btcDom, fx] = await Promise.all([fetchFearGreed(), fetchBtcDominance(), fetchForexUplink(FETCH_TIMEOUT_MS)]);
    const macroSentimentScore = computeMacroSentimentScore(fng.value, btcDom);
    const minimumConfidenceThreshold = getMinimumConfidenceThreshold(fng.value);
    const strategyLabelHe = getActiveStrategyLabelHe(fng.value);

    return {
      fearGreedIndex: fng.value,
      fearGreedClassification: fng.classification,
      btcDominancePct: btcDom,
      macroSentimentScore,
      minimumConfidenceThreshold,
      strategyLabelHe,
      forexUplink: {
        dxy: fx.dxy,
        eurUsd: fx.eurUsd,
        usdIls: fx.usdIls,
        ilsRiskNoteHe: ilsRiskNoteHe(fx.usdIls),
      },
    };
  } catch {
    return { ...DEFAULT_MACRO };
  }
}
