/**
 * Market Safety Sentinel (הגנת ימים מסוכנים).
 * Analyzes BTC/ETH volatility and ATR to mark the day as SAFE or DANGEROUS for trading.
 */

import { APP_CONFIG } from '@/lib/config';
import { atr } from '@/lib/indicators';

const BTC_SYMBOL = 'BTCUSDT';
const ETH_SYMBOL = 'ETHUSDT';
const VOLATILITY_THRESHOLD_PCT = 5;

export type MarketRiskStatus = 'SAFE' | 'DANGEROUS';

export interface MarketRiskSentiment {
  status: MarketRiskStatus;
  reasoning: string;
  btc24hVolatilityPct: number | null;
  eth24hVolatilityPct: number | null;
  btcAtrPct: number | null;
  ethAtrPct: number | null;
  checkedAt: string;
}

async function fetchKlines(symbol: string, limit = 15): Promise<{ highs: number[]; lows: number[]; closes: number[] }> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=${limit}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { highs: [], lows: [], closes: [] };
    const data = (await res.json()) as Array<[number, string, string, string, string, string]>;
    const highs: number[] = [];
    const lows: number[] = [];
    const closes: number[] = [];
    for (const row of data) {
      if (!Array.isArray(row) || row.length < 5) continue;
      highs.push(parseFloat(row[2]!) || 0);
      lows.push(parseFloat(row[3]!) || 0);
      closes.push(parseFloat(row[4]!) || 0);
    }
    return { highs, lows, closes };
  } catch {
    clearTimeout(timeout);
    return { highs: [], lows: [], closes: [] };
  }
}

/** 24h volatility = (high - low) / close * 100 for the latest candle. */
function volatility24hPct(highs: number[], lows: number[], closes: number[]): number | null {
  if (closes.length < 1 || highs.length < 1 || lows.length < 1) return null;
  const last = closes.length - 1;
  const c = closes[last]!;
  if (c <= 0) return null;
  const range = (highs[last]! - lows[last]!) / c * 100;
  return Number.isFinite(range) ? range : null;
}

/** ATR as % of current price. */
function atrPct(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  const atrVal = atr(highs, lows, closes, period);
  if (atrVal == null || closes.length < 1) return null;
  const lastClose = closes[closes.length - 1]!;
  if (lastClose <= 0) return null;
  return (atrVal / lastClose) * 100;
}

/**
 * Analyzes overall market volatility using BTC and ETH as proxies.
 * If BTC 24h volatility > 5% or ATR is spiked (ATR/price > 5%), marks the day as DANGEROUS.
 */
export async function getMarketRiskSentiment(): Promise<MarketRiskSentiment> {
  const checkedAt = new Date().toISOString();
  const [btc, eth] = await Promise.all([
    fetchKlines(BTC_SYMBOL),
    fetchKlines(ETH_SYMBOL),
  ]);

  const btcVol = volatility24hPct(btc.highs, btc.lows, btc.closes);
  const ethVol = volatility24hPct(eth.highs, eth.lows, eth.closes);
  const btcAtr = atrPct(btc.highs, btc.lows, btc.closes);
  const ethAtr = atrPct(eth.highs, eth.lows, eth.closes);

  const reasons: string[] = [];
  let dangerous = false;

  if (btcVol != null && btcVol > VOLATILITY_THRESHOLD_PCT) {
    dangerous = true;
    reasons.push(`תנודתיות BTC 24h: ${btcVol.toFixed(2)}% (מעל ${VOLATILITY_THRESHOLD_PCT}%)`);
  }
  if (ethVol != null && ethVol > VOLATILITY_THRESHOLD_PCT) {
    dangerous = true;
    reasons.push(`תנודתיות ETH 24h: ${ethVol.toFixed(2)}% (מעל ${VOLATILITY_THRESHOLD_PCT}%)`);
  }
  if (btcAtr != null && btcAtr > VOLATILITY_THRESHOLD_PCT) {
    dangerous = true;
    reasons.push(`ATR BTC מוגבר: ${btcAtr.toFixed(2)}% ממחיר`);
  }
  if (ethAtr != null && ethAtr > VOLATILITY_THRESHOLD_PCT) {
    dangerous = true;
    reasons.push(`ATR ETH מוגבר: ${ethAtr.toFixed(2)}% ממחיר`);
  }

  const status: MarketRiskStatus = dangerous ? 'DANGEROUS' : 'SAFE';
  const reasoning =
    dangerous && reasons.length > 0
      ? reasons.join('; ')
      : btcVol != null || ethVol != null
        ? `תנודתיות BTC: ${btcVol?.toFixed(2) ?? '—'}% | ETH: ${ethVol?.toFixed(2) ?? '—'}%. ATR תקין.`
        : 'לא ניתן לחשב תנודתיות — נתוני שוק חסרים.';

  return {
    status,
    reasoning,
    btc24hVolatilityPct: btcVol,
    eth24hVolatilityPct: ethVol,
    btcAtrPct: btcAtr ?? null,
    ethAtrPct: ethAtr ?? null,
    checkedAt,
  };
}
