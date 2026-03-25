/**
 * Technical Analysis indicators for the Cognitive Core.
 * מדד עוצמה יחסית (RSI), ממוצע נע מעריכי (EMA).
 */

/** RSI (14 periods) — מדד עוצמה יחסית. Standard formula. Returns 0–100. */
export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const slice = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i]! - slice[i - 1]!;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** EMA (Exponential Moving Average) — ממוצע נע מעריכי. multiplier = 2 / (period + 1). */
export function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let emaVal = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    emaVal = closes[i]! * k + emaVal * (1 - k);
  }
  return emaVal;
}

/** EMA 20 and EMA 50 from close prices. */
export function ema20(closes: number[]): number | null {
  return ema(closes, 20);
}

export function ema50(closes: number[]): number | null {
  return ema(closes, 50);
}

export interface IndicatorSnapshot {
  rsi14: number;
  ema20: number | null;
  ema50: number | null;
}

/**
 * ATR (Average True Range) — טווח אמיתי ממוצע.
 * TR = max(H-L, |H-PrevClose|, |L-PrevClose|). ATR = EMA of TR over period.
 */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number | null {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return null;
  const len = Math.min(highs.length, lows.length, closes.length);
  const tr: number[] = [];
  for (let i = 1; i < len; i++) {
    const h = highs[i]!;
    const l = lows[i]!;
    const prevClose = closes[i - 1]!;
    const trVal = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
    tr.push(trVal);
  }
  if (tr.length < period) return null;
  const k = 2 / (period + 1);
  let emaTr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    emaTr = tr[i]! * k + emaTr * (1 - k);
  }
  return emaTr;
}

/** Compute RSI(14), EMA(20), EMA(50) from close prices. */
export function computeIndicators(closes: number[]): IndicatorSnapshot {
  return {
    rsi14: rsi(closes, 14),
    ema20: ema20(closes),
    ema50: ema50(closes),
  };
}
