/**
 * Shared Technical Context: EMA20/50/200, Bollinger Bands, Market Structure.
 * Single source of truth for backtest engine and live scanner (Daily 8 AM / doAnalysisCore).
 */

export type MarketStructure = 'HH/HL' | 'LH/LL' | 'RANGE' | 'MIXED' | 'UNKNOWN';

export interface TechnicalContextResult {
  technicalContextTextHe: string;
  assetMomentumTextHe: string;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** EMA series for closes; null until period is filled. */
export function computeEmaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (period <= 0) return out;
  const k = 2 / (period + 1);
  let ema: number | null = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (i < period) {
      sum += v;
      if (i === period - 1) {
        ema = sum / period;
        out[i] = ema;
      }
      continue;
    }
    if (ema == null) continue;
    ema = v * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

export function computeBollingerSeries(
  closes: number[],
  period = 20,
  stdevMult = 2
): { mid: Array<number | null>; upper: Array<number | null>; lower: Array<number | null>; percentB: Array<number | null> } {
  const mid: Array<number | null> = new Array(closes.length).fill(null);
  const upper: Array<number | null> = new Array(closes.length).fill(null);
  const lower: Array<number | null> = new Array(closes.length).fill(null);
  const percentB: Array<number | null> = new Array(closes.length).fill(null);

  if (period <= 1) return { mid, upper, lower, percentB };
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < closes.length; i++) {
    const v = closes[i]!;
    sum += v;
    sumSq += v * v;

    if (i >= period) {
      const old = closes[i - period]!;
      sum -= old;
      sumSq -= old * old;
    }

    if (i >= period - 1) {
      const mean = sum / period;
      const variance = Math.max(0, sumSq / period - mean * mean);
      const stdev = Math.sqrt(variance);
      const up = mean + stdevMult * stdev;
      const lo = mean - stdevMult * stdev;
      mid[i] = mean;
      upper[i] = up;
      lower[i] = lo;
      const denom = up - lo;
      percentB[i] = denom > 0 ? (v - lo) / denom : null;
    }
  }

  return { mid, upper, lower, percentB };
}

export function inferMarketStructure(params: {
  highs: number[];
  lows: number[];
  idx: number;
  window: number;
}): MarketStructure {
  const { highs, lows, idx, window } = params;
  if (idx < 10) return 'UNKNOWN';
  const w = Math.max(10, window);
  const end = idx;
  const start = Math.max(0, end - w + 1);
  const mid = Math.max(start, end - Math.floor(w / 2));
  if (mid - start < 3 || end - mid < 3) return 'UNKNOWN';

  const max1 = Math.max(...highs.slice(start, mid));
  const max2 = Math.max(...highs.slice(mid, end + 1));
  const min1 = Math.min(...lows.slice(start, mid));
  const min2 = Math.min(...lows.slice(mid, end + 1));

  const higherHigh = max2 > max1 * 1.001;
  const higherLow = min2 > min1 * 1.001;
  const lowerHigh = max2 < max1 * 0.999;
  const lowerLow = min2 < min1 * 0.999;

  if (higherHigh && higherLow) return 'HH/HL';
  if (lowerHigh && lowerLow) return 'LH/LL';
  if ((!higherHigh && !lowerHigh) && (!higherLow && !lowerLow)) return 'RANGE';
  return 'MIXED';
}

export function buildTechnicalContext(params: {
  idx: number;
  close: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  bbMid: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  bbPercentB: number | null;
  marketStructure: MarketStructure;
  oiStatus?: 'Rising' | 'Falling' | 'Stable';
  oiChangePct?: number | null;
}): TechnicalContextResult {
  const { close, ema20, ema50, ema200, bbMid, bbUpper, bbLower, bbPercentB, marketStructure, oiStatus, oiChangePct } = params;

  const emaParts: string[] = [];
  if (ema20 != null) emaParts.push(`EMA20 ${round2(ema20)}`);
  if (ema50 != null) emaParts.push(`EMA50 ${round2(ema50)}`);
  if (ema200 != null) emaParts.push(`EMA200 ${round2(ema200)}`);

  const emaTrend =
    ema20 != null && ema50 != null && ema200 != null
      ? ema20 > ema50 && ema50 > ema200
        ? 'טרנד עולה (EMA20>EMA50>EMA200)'
        : ema20 < ema50 && ema50 < ema200
          ? 'טרנד יורד (EMA20<EMA50<EMA200)'
          : 'טרנד מעורב (EMAs לא מיושרים)'
      : 'טרנד EMA לא זמין (נתונים חלקיים)';

  const bbText =
    bbMid != null && bbUpper != null && bbLower != null
      ? `בולינגר(20,2): אמצע ${round2(bbMid)} | עליון ${round2(bbUpper)} | תחתון ${round2(bbLower)}`
      : 'בולינגר(20,2): לא זמין';
  const bbPos =
    bbPercentB != null
      ? bbPercentB > 1.0
        ? 'מחוץ לרצועה העליונה (מתוח/אוברבוט)'
        : bbPercentB < 0.0
          ? 'מחוץ לרצועה התחתונה (מתוח/אוברסולד)'
          : bbPercentB >= 0.8
            ? 'קרוב לרצועה העליונה'
            : bbPercentB <= 0.2
              ? 'קרוב לרצועה התחתונה'
              : 'באזור האמצע'
      : 'מיקום בולינגר לא זמין';

  const structureHe =
    marketStructure === 'HH/HL'
      ? 'מבנה שוק: שיאים ושפלים עולים (HH/HL)'
      : marketStructure === 'LH/LL'
        ? 'מבנה שוק: שיאים ושפלים יורדים (LH/LL)'
        : marketStructure === 'RANGE'
          ? 'מבנה שוק: טווח / דשדוש'
          : marketStructure === 'MIXED'
            ? 'מבנה שוק: מעורב (שבירות חלקיות)'
            : 'מבנה שוק: לא ברור';

  const assetMomentumTextHe =
    ema20 != null && ema50 != null
      ? close > ema20 && ema20 > ema50
        ? 'מומנטום חיובי — מחיר מעל EMA20 ו-EMA20 מעל EMA50'
        : close < ema20 && ema20 < ema50
          ? 'מומנטום שלילי — מחיר מתחת EMA20 ו-EMA20 מתחת EMA50'
          : close >= ema20
            ? 'מומנטום ניטרלי-חיובי — מחיר מעל EMA20 אך מבנה EMA לא חד'
            : 'מומנטום ניטרלי-שלילי — מחיר מתחת EMA20 אך מבנה EMA לא חד'
      : 'מומנטום לא זמין (EMA חסר)';

  const oiPart =
    oiStatus != null && oiChangePct != null
      ? ` Open Interest Status: ${oiStatus}. OI Change: ${oiChangePct >= 0 ? '+' : ''}${round2(oiChangePct)}%.`
      : '';

  const technicalContextTextHe =
    `הקשר טכני מועשר: ${emaTrend}. ` +
    `EMAs: ${emaParts.join(' | ') || 'N/A'}. ` +
    `${bbText}. מיקום: ${bbPos}. ` +
    `${structureHe}.` +
    oiPart;

  return { technicalContextTextHe, assetMomentumTextHe };
}
