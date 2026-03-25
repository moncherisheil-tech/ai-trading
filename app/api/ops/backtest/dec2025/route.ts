import { NextRequest, NextResponse } from 'next/server';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';
import { runDec2025QuantumBacktest } from '@/lib/ops/dec2025-apex-backtest';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Strict header auth only (Bearer ADMIN_SECRET or x-cron-secret).
 * Dec 2025 quantum backtest: OHLCV, RSI, MACD, simulated OI/funding, runConsensusEngine, PnL with 0.1% slippage/side.
 */
export async function POST(req: NextRequest) {
  if (!validateAdminOrCronAuth(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let symbol = 'BTCUSDT';
  let maxConsensusCandles: number | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.symbol && typeof body.symbol === 'string') {
      symbol = body.symbol.trim().toUpperCase();
    }
    const rawMax = body?.maxCandles ?? body?.maxConsensusCandles;
    if (typeof rawMax === 'number' && Number.isFinite(rawMax)) {
      maxConsensusCandles = Math.max(1, Math.min(500, Math.floor(rawMax)));
    } else if (typeof rawMax === 'string' && rawMax.trim() !== '') {
      const n = Number(rawMax);
      if (Number.isFinite(n)) maxConsensusCandles = Math.max(1, Math.min(500, Math.floor(n)));
    }
  } catch {
    /* default symbol */
  }

  try {
    const result = await runDec2025QuantumBacktest(symbol, { maxConsensusCandles });
    const { points, ...summary } = result;
    return NextResponse.json({
      ok: true,
      ...summary,
      /** Omit full consensus payloads from default response to reduce payload size. */
      samplePoints: points.slice(0, 3).map((p) => ({
        openTime: p.openTime,
        close: p.close,
        rsi14: p.rsi14,
        direction: p.direction,
        outcome: p.outcome,
        final_confidence: p.consensus.final_confidence,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dec 2025 backtest failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!validateAdminOrCronAuth(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const symbol = (req.nextUrl.searchParams.get('symbol') || 'BTCUSDT').trim().toUpperCase();
  const mc = req.nextUrl.searchParams.get('maxCandles');
  const mcNum = mc != null && mc !== '' ? Number(mc) : NaN;
  const maxConsensusCandles =
    Number.isFinite(mcNum) ? Math.max(1, Math.min(500, Math.floor(mcNum))) : undefined;
  try {
    const result = await runDec2025QuantumBacktest(
      symbol,
      maxConsensusCandles != null ? { maxConsensusCandles } : undefined
    );
    const { points, ...summary } = result;
    return NextResponse.json({
      ok: true,
      ...summary,
      samplePoints: points.slice(0, 3).map((p) => ({
        openTime: p.openTime,
        close: p.close,
        rsi14: p.rsi14,
        direction: p.direction,
        outcome: p.outcome,
        final_confidence: p.consensus.final_confidence,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dec 2025 backtest failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
