/**
 * POST: Production-grade simulation — live spot from Binance, formatted Signal of Gold to Telegram.
 * No DB writes. Auth: Bearer ADMIN_SECRET or x-cron-secret.
 *
 * Body (optional JSON): { "symbol": "BTCUSDT", "bias": "Bullish" | "Bearish", "strengthPct": 88 }
 */

import { NextResponse } from 'next/server';
import { fetchBinanceTickerPrices } from '@/lib/api-utils';
import { sendSignalOfGoldAlert } from '@/lib/telegram';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';
import { bandForSymbol } from '@/lib/price-bands';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function normalizeSymbol(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  if (!s) return 'BTCUSDT';
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

function displayPair(binanceSymbol: string): string {
  const base = binanceSymbol.replace(/USDT$/i, '');
  return `${base}/USDT`;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    /* optional body */
  }

  const symbol = normalizeSymbol(body.symbol);
  const bias = body.bias === 'Bearish' ? 'Bearish' : 'Bullish';
  const strengthRaw = body.strengthPct;
  const strengthPct =
    typeof strengthRaw === 'number' && Number.isFinite(strengthRaw)
      ? Math.min(100, Math.max(0, strengthRaw))
      : 88;

  try {
    const prices = await fetchBinanceTickerPrices([symbol], 12_000);
    const spot = prices.get(symbol);
    if (spot == null || !Number.isFinite(spot) || spot <= 0) {
      console.error('[signal-of-gold-sim] binance price missing', { symbol });
      return NextResponse.json(
        { ok: false, error: 'Live price unavailable for symbol.' },
        { status: 502 }
      );
    }

    const band = bandForSymbol(symbol);
    if (spot < band.min || spot > band.max) {
      console.error('[signal-of-gold-sim] spot outside sanity band', { symbol, spot, band });
      return NextResponse.json(
        { ok: false, error: 'Spot price failed sanity check.' },
        { status: 422 }
      );
    }

    /** Entry band ±0.15% around spot (simulation ladder). */
    const zoneFrac = 0.0015;
    const lo = spot * (1 - zoneFrac);
    const hi = spot * (1 + zoneFrac);

    /** TP/SL as absolute levels (~+1.8% / ~−1.2% from spot for long sim). */
    const tpPct = 0.018;
    const slPct = 0.012;
    const takeProfit = bias === 'Bullish' ? spot * (1 + tpPct) : spot * (1 - tpPct);
    const stopLoss = bias === 'Bullish' ? spot * (1 - slPct) : spot * (1 + slPct);

    const consensusExcerpt =
      'יישור קו בין מומחי הלוח: מבנה, זרימה ושערי סיכון עמדו בדרישות; רמת ביטחון עלתה לאחר סינון מפקח. סימולציה בלבד — אינו ייעוץ השקעות.';

    const telegram = await sendSignalOfGoldAlert({
      symbolDisplay: displayPair(symbol),
      symbolBinance: symbol,
      strengthPct,
      bias,
      spotPrice: spot,
      entryLow: lo,
      entryHigh: hi,
      takeProfit,
      stopLoss,
      consensusExcerpt,
    });

    return NextResponse.json({
      ok: telegram.ok,
      telegram,
      simulation: {
        symbol,
        spot,
        bias,
        strengthPct,
        entryZone: [lo, hi],
        takeProfit,
        stopLoss,
      },
    });
  } catch (err) {
    console.error('[signal-of-gold-sim] failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { ok: false, error: 'Signal simulation failed. Check server logs.' },
      { status: 500 }
    );
  }
}
