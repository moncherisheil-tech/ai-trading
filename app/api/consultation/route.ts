import { NextRequest, NextResponse } from 'next/server';
import { fetchWithBackoff } from '@/lib/api-utils';
import { APP_CONFIG } from '@/lib/config';
import { rsi, ema20, ema50 } from '@/lib/indicators';
import { listClosedVirtualTradesBySource } from '@/lib/db/virtual-portfolio';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

export type ConsultationSignal = 'Buy' | 'Hold' | 'Sell';

export interface ConsultationResponse {
  symbol: string;
  currentSignal: ConsultationSignal;
  technicalSetup: {
    rsi: number;
    ema20: number | null;
    ema50: number | null;
    priceAboveEma20: boolean;
    bullishTrend: boolean;
    price: number;
  };
  confidenceScore: number;
  reasoning: string;
}

async function getTechnicalSetup(symbol: string): Promise<ConsultationResponse['technicalSetup'] | null> {
  const normalized = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/klines?symbol=${encodeURIComponent(normalized)}&interval=1d&limit=60`;
  try {
    const res = await fetchWithBackoff(url, { timeoutMs: 8000, maxRetries: 2, cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<[number, string, string, string, string, string]>;
    const closes = data
      .filter((row) => Array.isArray(row) && row.length >= 5)
      .map((row) => parseFloat((row as unknown as Record<number, string>)[4]));
    if (closes.length < 20) return null;
    const price = closes[closes.length - 1]!;
    const rsiVal = rsi(closes, 14);
    const ema20Val = ema20(closes);
    const ema50Val = ema50(closes);
    const priceAboveEma20 = ema20Val != null && price > ema20Val;
    const bullishTrend = ema20Val != null && ema50Val != null && ema20Val > ema50Val;
    return {
      rsi: rsiVal,
      ema20: ema20Val,
      ema50: ema50Val,
      priceAboveEma20,
      bullishTrend,
      price,
    };
  } catch {
    return null;
  }
}

function buildReasoning(
  signal: ConsultationSignal,
  setup: ConsultationResponse['technicalSetup'],
  confidence: number,
  symbol: string,
  winRatePct: number
): string {
  const base = symbol.replace('USDT', '');
  if (signal === 'Buy' && confidence >= 60) {
    return `ביטחון גבוה: השילוב של פריצת נפח ומחיר מעל ממוצע נע מעריכי (EMA 20) היסטורית הניב ${Math.round(winRatePct)}% הצלחה במטבע זה. מדד עוצמה יחסית (RSI) ${setup.rsi.toFixed(0)} — לא באזור קניית יתר.`;
  }
  if (signal === 'Buy') {
    return `מדד ביטחון ${confidence}/100. מחיר מעל EMA 20, RSI ${setup.rsi.toFixed(0)}. מומלץ להמתין לאישור נפח.`;
  }
  if (signal === 'Sell') {
    return `מדד עוצמה יחסית (RSI) גבוה (${setup.rsi.toFixed(0)}) או מחיר מתחת לממוצע נע מעריכי — זהירות מקניית יתר ב-${base}.`;
  }
  return `מצב ניטרלי: מדד ביטחון ${confidence}/100. ממוצע נע מעריכי (EMA 20/50) ו-RSI לא נותנים איתות ברור — המתנה מומלצת.`;
}

/**
 * GET /api/consultation?symbol=BTC
 * Returns: currentSignal, technicalSetup (RSI, EMA), confidenceScore, reasoning (Hebrew).
 */
export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get('symbol') || '').trim().toUpperCase();
  const normalized = symbol.endsWith('USDT') ? symbol : symbol ? `${symbol}USDT` : '';
  if (!normalized) {
    return NextResponse.json(
      { error: 'נא לציין סמל (symbol).' },
      { status: 400 }
    );
  }

  const [setup, confidence] = await Promise.all([
    getTechnicalSetup(normalized),
    (async () => {
      const { getAgentConfidence } = await import('@/lib/smart-agent');
      return getAgentConfidence(normalized);
    })(),
  ]);

  if (!setup) {
    return NextResponse.json(
      { error: 'לא ניתן לטעון נתונים טכניים עבור הסמל.' },
      { status: 502 }
    );
  }

  let currentSignal: ConsultationSignal = 'Hold';
  if (setup.priceAboveEma20 && setup.rsi < 70 && setup.bullishTrend) currentSignal = 'Buy';
  else if (setup.rsi >= 70 || (!setup.priceAboveEma20 && !setup.bullishTrend)) currentSignal = 'Sell';

  const closed = await listClosedVirtualTradesBySource('agent', normalized, 50);
  const wins = closed.filter((t) => t.pnl_pct != null && t.pnl_pct > 0).length;
  const winRatePct = closed.length > 0 ? (wins / closed.length) * 100 : 50;

  const reasoning = buildReasoning(currentSignal, setup, confidence, normalized, winRatePct);

  const body: ConsultationResponse = {
    symbol: normalized,
    currentSignal,
    technicalSetup: {
      rsi: Math.round(setup.rsi * 10) / 10,
      ema20: setup.ema20,
      ema50: setup.ema50,
      priceAboveEma20: setup.priceAboveEma20,
      bullishTrend: setup.bullishTrend,
      price: setup.price,
    },
    confidenceScore: Math.round(confidence),
    reasoning,
  };

  return NextResponse.json(body);
}
