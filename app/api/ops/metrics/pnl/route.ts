import { NextRequest, NextResponse } from 'next/server';
import { listBacktests, type BacktestLogEntry } from '@/lib/db/backtest-repository';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import Decimal from 'decimal.js';
import { round2, toDecimal, D } from '@/lib/decimal';
import { sharpeFromDailyReturns } from '@/lib/math-utils';

export const maxDuration = 60;

const BASE_POSITION_USD = D.basePositionUsd;
const FEE_PCT = D.feePct; // 0.1% per trade (round-trip)

function getDateKey(isoString: string): string {
  return isoString.slice(0, 10);
}
function getMonthKey(isoString: string): string {
  return isoString.slice(0, 7);
}

/** Suggested position size: 50% during extreme sentiment (confidence penalty). */
function positionUsd(entry: BacktestLogEntry): Decimal {
  const extreme = typeof entry.sentiment_score === 'number' && (entry.sentiment_score <= -0.8 || entry.sentiment_score >= 0.8);
  return extreme ? BASE_POSITION_USD.times(0.5) : BASE_POSITION_USD;
}

/** P&L per trade: direction-aware % return on suggested position, minus 0.1% fee. */
function tradePnL(entry: BacktestLogEntry): Decimal {
  let profitPct = toDecimal(0);
  if (entry.predicted_direction === 'Bullish') {
    profitPct = toDecimal(entry.price_diff_pct);
  } else if (entry.predicted_direction === 'Bearish') {
    profitPct = toDecimal(-entry.price_diff_pct);
  }
  const pos = positionUsd(entry);
  const grossUsd = pos.times(profitPct).div(100);
  const feeUsd = pos.times(FEE_PCT).div(100);
  return grossUsd.minus(feeUsd);
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
    const win = pnl.greaterThan(0);
    return {
      prediction_id: entry.prediction_id,
      symbol: entry.symbol,
      evaluated_at: entry.evaluated_at,
      date: getDateKey(entry.evaluated_at),
      predicted_direction: entry.predicted_direction,
      price_diff_pct: entry.price_diff_pct,
      pnl_usd: round2(pnl),
      win,
      risk_status: riskStatusFromSentiment(entry.sentiment_score),
    };
  });

  const byDate = new Map<string, Decimal>();
  for (const t of trades) {
    const current = byDate.get(t.date) ?? D.zero;
    byDate.set(t.date, current.plus(t.pnl_usd));
  }

  const dailyPnl = Array.from(byDate.entries())
    .map(([date, pnl]) => ({ date, pnl: round2(pnl) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const startingBalance = D.startingBalance;
  let running = startingBalance;
  const equityCurve: { date: string; balance: number; cumulative_pnl: number }[] = [];
  for (const d of dailyPnl) {
    running = running.plus(d.pnl);
    equityCurve.push({
      date: d.date,
      balance: round2(running),
      cumulative_pnl: round2(running.minus(startingBalance)),
    });
  }

  const totalPnl = running.minus(startingBalance);
  const totalPnlPct = startingBalance.isZero()
    ? 0
    : totalPnl.div(startingBalance).times(100).toNumber();
  const wins = trades.filter((t) => t.win).length;
  const losses = trades.filter((t) => !t.win && t.pnl_usd !== 0).length;
  const grossProfit = trades
    .filter((t) => t.pnl_usd > 0)
    .reduce((s, t) => s.plus(t.pnl_usd), D.zero);
  const grossLoss = trades
    .filter((t) => t.pnl_usd < 0)
    .reduce((s, t) => s.plus(t.pnl_usd), D.zero)
    .abs();
  // Profit Factor = sum(gross profits) / sum(gross losses). Zero-loss: 999 if any profit, else 0. No NaN/infinity.
  let profitFactor: number;
  if (grossLoss.greaterThan(0)) {
    const pf = grossProfit.div(grossLoss).toNumber();
    profitFactor = Number.isFinite(pf) && pf >= 0 ? round2(pf) : 0;
  } else {
    profitFactor = grossProfit.greaterThan(0) ? 999 : 0;
  }

  /** Sharpe ratio (annualized): daily returns vs risk-free 0. NaN-safe; returns 0 when insufficient data or zero variance. */
  const dailyReturns = dailyPnl.map((d) => startingBalance.gt(0) ? toDecimal(d.pnl).div(startingBalance).toNumber() : 0);
  const sharpeRatio = round2(sharpeFromDailyReturns(dailyReturns));

  let peak = startingBalance;
  let maxDrawdown = D.zero;
  for (const point of equityCurve) {
    const bal = toDecimal(point.balance);
    if (bal.greaterThan(peak)) peak = bal;
    const dd = peak.minus(bal);
    if (dd.greaterThan(maxDrawdown)) maxDrawdown = dd;
  }
  const maxDrawdownPct = peak.greaterThan(0)
    ? maxDrawdown.div(peak).times(100).toNumber()
    : 0;
  const winRatePct = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  const byMonth = new Map<string, Decimal>();
  for (const t of trades) {
    const month = getMonthKey(t.evaluated_at);
    const cur = byMonth.get(month) ?? D.zero;
    byMonth.set(month, cur.plus(t.pnl_usd));
  }
  const monthlyPnl = Array.from(byMonth.entries())
    .map(([month, pnl]) => ({ month, pnl: round2(pnl) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const bySymbol = new Map<string, { pnl: Decimal; wins: number; count: number }>();
  for (const t of trades) {
    const cur = bySymbol.get(t.symbol) ?? { pnl: D.zero, wins: 0, count: 0 };
    cur.pnl = cur.pnl.plus(t.pnl_usd);
    cur.count += 1;
    if (t.win) cur.wins += 1;
    bySymbol.set(t.symbol, cur);
  }
  const topStrategies = Array.from(bySymbol.entries())
    .map(([symbol, agg]) => ({
      symbol,
      pnl: round2(agg.pnl),
      wins: agg.wins,
      count: agg.count,
    }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 5);

  return NextResponse.json({
    success: true,
    startingBalance: D.startingBalance.toNumber(),
    totalPnl: round2(totalPnl),
    totalPnlPct: round2(totalPnlPct),
    winRatePct: round2(winRatePct),
    profitFactor: round2(profitFactor),
    sharpeRatio,
    maxDrawdown: round2(maxDrawdown),
    maxDrawdownPct: round2(maxDrawdownPct),
    equityCurve,
    dailyPnl,
    monthlyPnl,
    topStrategies,
    trades: trades.slice(-20).reverse(),
    totalTrades: trades.length,
  });
}
