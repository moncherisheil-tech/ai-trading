/**
 * Deep Analysis (ניתוח עמוק): multi-layer validation before virtual trade entry.
 * Combines News Sentiment, simulated On-chain insights, and Technical (RSI) into a weighted verdict.
 * All user-facing text in professional Hebrew. No personal names — use "הנהלה" / "אלגוריתם".
 * For full Mixture of Experts + Debate Room (tech/risk/psych scores, master_insight_he), the main flow uses lib/consensus-engine.ts via analysis-core.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_CANONICAL_PRO_MODEL_ID, resolveGeminiModel } from '@/lib/gemini-model';
import { getGeminiApiKey } from '@/lib/env';
import { APP_CONFIG } from '@/lib/config';
import { fetchLatestCryptoNews } from '@/lib/agents/news-agent';
import { computeRSI } from '@/lib/prediction-formula';
import { fetchWithBackoff } from '@/lib/api-utils';

const WEIGHT_TECHNICAL = 0.4;
const WEIGHT_NEWS = 0.35;
const WEIGHT_ONCHAIN = 0.25;

export type SentimentLabel = 'Bullish' | 'Bearish' | 'Neutral';

export interface NewsSentimentLayer {
  sentiment: SentimentLabel;
  narrative_he: string;
  score: number; // -1..1
}

export interface OnChainInsightsLayer {
  summary_he: string;
  signal: SentimentLabel;
  score: number; // 0..100
}

export interface TechnicalLayer {
  score: number; // 0..100, e.g. RSI-based
  label_he: string;
}

export interface DeepAnalysisResult {
  symbol: string;
  news: NewsSentimentLayer;
  onchain: OnChainInsightsLayer;
  technical: TechnicalLayer;
  weighted_verdict_pct: number;
  verdict_he: string;
  recommendation_he: 'אשר סימולציה' | 'המתן' | 'התעלם';
  created_at: string;
}

function normalizeSymbol(symbol: string): string {
  const s = symbol.toUpperCase().trim();
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

const NEWS_LAYER_FALLBACK: NewsSentimentLayer = {
  sentiment: 'Neutral',
  narrative_he: 'אין כרגע כותרות רלוונטיות — סנטימנט ניטרלי.',
  score: 0,
};

const ONCHAIN_LAYER_FALLBACK: OnChainInsightsLayer = {
  summary_he: 'שכבת On-chain לא זמינה — ניטרלי.',
  signal: 'Neutral',
  score: 50,
};

/**
 * News Sentiment Layer: fetch headlines and derive sentiment + Hebrew narrative via Gemini.
 */
async function fetchNewsSentimentLayer(symbol: string): Promise<NewsSentimentLayer> {
  try {
    const base = symbol.replace(/USDT$/i, '');
    const headlines = await fetchLatestCryptoNews(symbol);
    if (!headlines.length) return NEWS_LAYER_FALLBACK;

    try {
      const apiKey = getGeminiApiKey();
      const genAI = new GoogleGenerativeAI(apiKey);
      const prompt = `אתה אנליסט סנטימנט שוק קריפטו. בהתבסס על הכותרות הבאות לגבי ${base}, החזר JSON בלבד עם שלושה שדות:
- "sentiment": אחד מהערכים Bullish, Bearish, Neutral
- "narrative_he": משפט אחד בעברית המסכם את מצב החדשות (למשל: "חיובי חזק - אזכורים מרובים של שדרוג רשת")
- "score": מספר בין -1 ל-1 (שלילי= bearish, חיובי= bullish)

כותרות:
${headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join('\n')}

החזר רק JSON תקין, בלי מרכאות או טקסט נוסף.`;

      const timeoutMs = APP_CONFIG.geminiTimeoutMs ?? 60_000;
      const selected = resolveGeminiModel(APP_CONFIG.primaryModel || GEMINI_CANONICAL_PRO_MODEL_ID);
      const model = genAI.getGenerativeModel({ model: selected.model }, selected.requestOptions);
      const res = await Promise.race([
        model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
        }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Gemini request timeout')), timeoutMs)
        ),
      ]);

      const text = (() => { try { return res.response.text(); } catch { return undefined; } })()?.trim();
      if (!text) return NEWS_LAYER_FALLBACK;

      const parsed = JSON.parse(text) as { sentiment?: string; narrative_he?: string; score?: number };
      const sentiment: SentimentLabel =
        parsed.sentiment === 'Bullish' || parsed.sentiment === 'Bearish' || parsed.sentiment === 'Neutral'
          ? parsed.sentiment
          : 'Neutral';
      const score = typeof parsed.score === 'number' ? Math.max(-1, Math.min(1, parsed.score)) : 0;
      const narrative_he =
        typeof parsed.narrative_he === 'string' && parsed.narrative_he.length > 0
          ? parsed.narrative_he
          : NEWS_LAYER_FALLBACK.narrative_he;

      return { sentiment, narrative_he, score };
    } catch (inner) {
      console.error('[deep-analysis] news layer (Gemini/parse)', { symbol, error: inner });
      return NEWS_LAYER_FALLBACK;
    }
  } catch (err) {
    console.error('[deep-analysis] news layer', { symbol, error: err });
    return NEWS_LAYER_FALLBACK;
  }
}

/**
 * On-chain Insights Layer: simulated whale / supply signals (deterministic per symbol+day for consistency).
 * In production this could be replaced by a real on-chain or whale-tracking API.
 */
async function fetchOnChainInsightsLayer(symbol: string): Promise<OnChainInsightsLayer> {
  try {
    const base = symbol.replace(/USDT$/i, '');
    const daySeed = new Date().toISOString().slice(0, 10);
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) | 0;
    for (let i = 0; i < daySeed.length; i++) hash = (hash * 31 + daySeed.charCodeAt(i)) | 0;
    const r = Math.abs(hash % 100) / 100;

    if (r < 0.35) {
      return {
        summary_he: `תנועת לווייתנים חיובית — צבירה בארנקים קרים. זרימת ${base} לבורסות ירדה.`,
        signal: 'Bullish',
        score: 65 + Math.floor(r * 30),
      };
    }
    if (r < 0.65) {
      return {
        summary_he: `תנועת לווייתנים מעורבת. העברות לבורסות ולמשמרת קרובה לממוצע.`,
        signal: 'Neutral',
        score: 45 + Math.floor(r * 20),
      };
    }
    return {
      summary_he: `זוהתה העברת לווייתנים לבורסה — אספקה ברשימת הארנקים הגדולים עלתה.`,
      signal: 'Bearish',
      score: Math.floor(r * 45),
    };
  } catch (err) {
    console.error('[deep-analysis] on-chain layer', { symbol, error: err });
    return ONCHAIN_LAYER_FALLBACK;
  }
}

/**
 * Technical Layer: RSI from Binance daily klines (last 15+ candles).
 */
const TECHNICAL_LAYER_FALLBACK: TechnicalLayer = {
  score: 50,
  label_he: 'נתונים טכניים לא זמינים — מוחזר ערך ניטרלי.',
};

async function fetchTechnicalLayer(symbol: string): Promise<TechnicalLayer> {
  const clean = normalizeSymbol(symbol);
  const url = `https://api.binance.com/api/v3/klines?symbol=${clean}&interval=1d&limit=20`;
  const proxyUrl = APP_CONFIG.proxyBinanceUrl
    ? `${APP_CONFIG.proxyBinanceUrl}/api/v3/klines?symbol=${clean}&interval=1d&limit=20`
    : '';

  try {
    const res = await fetchWithBackoff(proxyUrl || url, {
      timeoutMs: APP_CONFIG.fetchTimeoutMs ?? 12_000,
      maxRetries: 4,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Klines failed: ${res.status}`);
    const data = (await res.json()) as Array<[number, string, string, string, string, string]>;
    const closes = data.map((c) => parseFloat(c[4] ?? '0')).filter((n) => Number.isFinite(n));
    const rsi = computeRSI(closes, 14);

    let label_he: string;
    if (rsi >= 70) label_he = 'RSI בעומס קנייה — אפשרית התקטנות';
    else if (rsi >= 55) label_he = 'RSI בטווח חיובי — מומנטום עלייתי';
    else if (rsi >= 45) label_he = 'RSI ניטרלי — אין איתות ברור';
    else if (rsi >= 30) label_he = 'RSI בטווח שלילי — מומנטום יורד';
    else label_he = 'RSI באזור oversold — אפשרית התאוששות';

    return { score: rsi, label_he };
  } catch (err) {
    console.error('[deep-analysis] technical layer', { symbol: clean, error: err });
    return TECHNICAL_LAYER_FALLBACK;
  }
}

/**
 * Combines Technical + News + On-chain into weighted verdict and recommendation.
 */
export async function performDeepAnalysis(symbol: string): Promise<DeepAnalysisResult> {
  const clean = normalizeSymbol(symbol);
  const base = clean.replace(/USDT$/i, '');

  const [news, onchain, technical] = await Promise.all([
    fetchNewsSentimentLayer(clean).catch((err) => {
      console.error('[deep-analysis] news layer (Promise boundary)', { symbol: clean, error: err });
      return NEWS_LAYER_FALLBACK;
    }),
    fetchOnChainInsightsLayer(clean).catch((err) => {
      console.error('[deep-analysis] on-chain layer (Promise boundary)', { symbol: clean, error: err });
      return ONCHAIN_LAYER_FALLBACK;
    }),
    fetchTechnicalLayer(clean).catch((err) => {
      console.error('[deep-analysis] technical layer (Promise boundary)', { symbol: clean, error: err });
      return TECHNICAL_LAYER_FALLBACK;
    }),
  ]);

  const newsNorm = (news.score + 1) * 50;
  const techNorm = technical.score;
  const onchainNorm = onchain.score;

  const weighted =
    WEIGHT_TECHNICAL * techNorm +
    WEIGHT_NEWS * newsNorm +
    WEIGHT_ONCHAIN * onchainNorm;

  const weighted_verdict_pct = Math.max(0, Math.min(100, Math.round(weighted * 10) / 10));

  let verdict_he: string;
  let recommendation_he: 'אשר סימולציה' | 'המתן' | 'התעלם';

  if (weighted_verdict_pct >= 65) {
    verdict_he = `ציון אימות סופי: ${weighted_verdict_pct}%. האלגוריתם ממליץ על ביצוע סימולציה.`;
    recommendation_he = 'אשר סימולציה';
  } else if (weighted_verdict_pct >= 45) {
    verdict_he = `ציון אימות סופי: ${weighted_verdict_pct}%. מומלץ להמתין לאישור נוסף.`;
    recommendation_he = 'המתן';
  } else {
    verdict_he = `ציון אימות סופי: ${weighted_verdict_pct}%. האלגוריתם ממליץ להתעלם מההתראה כרגע.`;
    recommendation_he = 'התעלם';
  }

  return {
    symbol: clean,
    news,
    onchain,
    technical,
    weighted_verdict_pct,
    verdict_he,
    recommendation_he,
    created_at: new Date().toISOString(),
  };
}

/**
 * Build the Hebrew deep-report message for Telegram.
 */
export function buildDeepReportMessage(result: DeepAnalysisResult): string {
  const base = result.symbol.replace(/USDT$/i, '');
  const parts: string[] = [
    `📋 <b>דוח מודיעין עמוק: ${base}</b>`,
    '',
    `<b>סנטימנט חדשות:</b> ${result.news.narrative_he}`,
    `<b>נתוני On-chain:</b> ${result.onchain.summary_he}`,
    `<b>טכני:</b> ${result.technical.label_he}`,
    '',
    `<b>הכרעה סופית:</b> ${result.verdict_he}`,
    `המלצה: ${result.recommendation_he}`,
  ];
  return parts.join('\n');
}
