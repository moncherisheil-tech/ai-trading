import { NextRequest, NextResponse } from 'next/server';
import { listBacktests, type BacktestLogEntry } from '@/lib/db/backtest-repository';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';

const BASE_POSITION_USD = 1000;
const FEE_PCT = 0.1; // 0.1% per trade (round-trip)

function getDateKey(isoString: string): string {
  return isoString.slice(0, 10);
}
function getMonthKey(isoString: string): string {
  return isoString.slice(0, 7);
}

/** Suggested position size: 50% during extreme sentiment (confidence penalty). */
function positionUsd(entry: BacktestLogEntry): number {
  const extreme = typeof entry.sentiment_score === 'number' && (entry.sentiment_score <= -0.8 || entry.sentiment_score >= 0.8);
  return extreme ? BASE_POSITION_USD * 0.5 : BASE_POSITION_USD;
}

/** P&L per trade: direction-aware % return on suggested position, minus 0.1% fee. */
function tradePnL(entry: BacktestLogEntry): number {
  let profitPct = 0;
  if (entry.predicted_direction === 'Bullish') {
    profitPct = entry.price_diff_pct;
  } else if (entry.predicted_direction === 'Bearish') {
    profitPct = -entry.price_diff_pct;
  }
  const pos = positionUsd(entry);
  const grossUsd = (pos * profitPct) / 100;
  const feeUsd = (pos * FEE_PCT) / 100;
  return grossUsd - feeUsd;
}

function riskStatusFromSentiment(score?: number): 'normal' | 'extreme_fear' | 'extreme_greed' {
  if (typeof score !== 'number') return 'normal';
  if (score <= -0.8) return 'extreme_fear';
  if (score >= 0.8) return 'extreme_greed';
  return 'normal';
}

export async function GET(request: NextRequest) {
  if (isSessionEnabled()) {
    const token = request.cookies.get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }
  }

  const backtests = await listBacktests();
  const sorted = [...backtests].sort(
    (a, b) => new Date(a.evaluated_at).getTime() - new Date(b.evaluated_at).getTime()
  );

  const trades = sorted.map((entry) => {
    const pnl = tradePnL(entry);
    const win = pnl > 0;
    return {
      prediction_id: entry.prediction_id,
      symbol: entry.symbol,
      evaluated_at: entry.evaluated_at,
      date: getDateKey(entry.evaluated_at),
      predicted_direction: entry.predicted_direction,
      price_diff_pct: entry.price_diff_pct,
      pnl_usd: Math.round(pnl * 100) / 100,
      win,
      risk_status: riskStatusFromSentiment(entry.sentiment_score),
    };
  });

  const byDate = new Map<string, number>();
  for (const t of trades) {
    const current = byDate.get(t.date) ?? 0;
    byDate.set(t.date, current + t.pnl_usd);
  }

  const dailyPnl = Array.from(byDate.entries())
    .map(([date, pnl]) => ({ date, pnl: Math.round(pnl * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const startingBalance = 10000;
  let running = startingBalance;
  const equityCurve: { date: string; balance: number; cumulative_pnl: number }[] = [];
  const dateToCumulative = new Map<string, number>();
  for (const d of dailyPnl) {
    running += d.pnl;
    dateToCumulative.set(d.date, running);
    equityCurve.push({
      date: d.date,
      balance: Math.round(running * 100) / 100,
      cumulative_pnl: Math.round((running - startingBalance) * 100) / 100,
    });
  }

  const totalPnl = running - startingBalance;
  const totalPnlPct = startingBalance !== 0 ? (totalPnl / startingBalance) * 100 : 0;
  const wins = trades.filter((t) => t.win).length;
  const losses = trades.filter((t) => !t.win && t.pnl_usd !== 0).length;
  const grossProfit = trades.filter((t) => t.pnl_usd > 0).reduce((s, t) => s + t.pnl_usd, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl_usd < 0).reduce((s, t) => s + t.pnl_usd, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  let peak = startingBalance;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.balance > peak) peak = point.balance;
    const dd = peak - point.balance;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
  const winRatePct = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  const byMonth = new Map<string, number>();
  for (const t of trades) {
    const month = getMonthKey(t.evaluated_at);
    byMonth.set(month, (byMonth.get(month) ?? 0) + t.pnl_usd);
  }
  const monthlyPnl = Array.from(byMonth.entries())
    .map(([month, pnl]) => ({ month, pnl: Math.round(pnl * 100) / 100 }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const bySymbol = new Map<string, { pnl: number; wins: number; count: number }>();
  for (const t of trades) {
    const cur = bySymbol.get(t.symbol) ?? { pnl: 0, wins: 0, count: 0 };
    cur.pnl += t.pnl_usd;
    cur.count += 1;
    if (t.win) cur.wins += 1;
    bySymbol.set(t.symbol, cur);
  }
  const topStrategies = Array.from(bySymbol.entries())
    .map(([symbol, agg]) => ({ symbol, pnl: Math.round(agg.pnl * 100) / 100, wins: agg.wins, count: agg.count }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 5);

  return NextResponse.json({
    success: true,
    startingBalance: 10000,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPct: Math.round(totalPnlPct * 100) / 100,
    winRatePct: Math.round(winRatePct * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
    equityCurve,
    dailyPnl,
    monthlyPnl,
    topStrategies,
    trades: trades.slice(-20).reverse(),
    totalTrades: trades.length,
  });
}
