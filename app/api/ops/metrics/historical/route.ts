/**
 * Historical Analytics API — date-window metrics from backtest_logs + virtual_portfolio.
 * GET /api/ops/metrics/historical?from_date=ISO&to_date=ISO
 */

import { NextRequest, NextResponse } from 'next/server';
import { listBacktestsInRange, type BacktestLogEntry } from '@/lib/db/backtest-repository';
import { listClosedVirtualTradesInRange, type VirtualPortfolioRow } from '@/lib/db/virtual-portfolio';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { round2, toDecimal, D } from '@/lib/decimal';
import { sharpeFromDailyReturns } from '@/lib/math-utils';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

const BASE_POSITION_USD = D.basePositionUsd;
const FEE_PCT = D.feePct; // 0.1% per trade (round-trip)
/** Same as simulation initial wallet / PnL reference — single source of truth from lib/decimal. */
const REFERENCE_CAPITAL = D.startingBalance.toNumber();

function getDateKey(isoString: string): string {
  return isoString.slice(0, 10);
}

function positionUsd(entry: BacktestLogEntry): import('decimal.js').Decimal {
  const extreme =
    typeof entry.sentiment_score === 'number' &&
    (entry.sentiment_score <= -0.8 || entry.sentiment_score >= 0.8);
  return extreme ? BASE_POSITION_USD.times(0.5) : BASE_POSITION_USD;
}

function tradePnL(entry: BacktestLogEntry): import('decimal.js').Decimal {
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

/** Fee per backtest trade (round-trip 0.1% on position). */
function tradeFeeUsd(entry: BacktestLogEntry): number {
  return round2(positionUsd(entry).times(FEE_PCT).div(100));
}

/** Virtual trade PnL USD = amount_usd * (pnl_pct / 100). */
function virtualTradePnL(row: VirtualPortfolioRow): number {
  if (row.pnl_pct == null) return 0;
  return round2(toDecimal(row.amount_usd).times(row.pnl_pct).div(100));
}

/** Trade duration in hours (entry_date -> closed_at). */
function virtualTradeDurationHours(row: VirtualPortfolioRow): number | null {
  if (!row.closed_at || !row.entry_date) return null;
  const entry = new Date(row.entry_date).getTime();
  const closed = new Date(row.closed_at).getTime();
  if (Number.isNaN(entry) || Number.isNaN(closed)) return null;
  return (closed - entry) / (1000 * 60 * 60);
}

export async function GET(request: NextRequest) {
  if (isSessionEnabled()) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');

  if (!fromDate || !toDate) {
    return NextResponse.json(
      { success: false, error: 'Missing from_date or to_date (ISO 8601).' },
      { status: 400 }
    );
  }

  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json(
      { success: false, error: 'Invalid from_date or to_date.' },
      { status: 400 }
    );
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json(
      { success: false, error: 'from_date must be before or equal to to_date.' },
      { status: 400 }
    );
  }

  const [backtests, virtualClosed] = await Promise.all([
    listBacktestsInRange(fromDate, toDate),
    listClosedVirtualTradesInRange(fromDate, toDate),
  ]);

  const sortedBacktests = [...backtests].sort(
    (a, b) => new Date(a.evaluated_at).getTime() - new Date(b.evaluated_at).getTime()
  );

  type TradeLike = {
    date: string;
    pnl_usd: number;
    win: boolean;
    source: 'backtest' | 'virtual';
  };

  const backtestTrades: TradeLike[] = sortedBacktests.map((entry) => {
    const pnl = tradePnL(entry);
    return {
      date: getDateKey(entry.evaluated_at),
      pnl_usd: round2(pnl),
      win: pnl.greaterThan(0),
      source: 'backtest' as const,
    };
  });

  const virtualTrades: TradeLike[] = virtualClosed.map((row) => {
    const pnl = virtualTradePnL(row);
    return {
      date: row.closed_at ? getDateKey(row.closed_at) : '',
      pnl_usd: pnl,
      win: (row.pnl_pct ?? 0) > 0,
      source: 'virtual' as const,
    };
  });

  const allTrades = [...backtestTrades, ...virtualTrades].filter((t) => t.date);

  const byDate = new Map<string, import('decimal.js').Decimal>();
  for (const t of allTrades) {
    const current = byDate.get(t.date) ?? D.zero;
    byDate.set(t.date, current.plus(t.pnl_usd));
  }

  const dailyPnl = Array.from(byDate.entries())
    .map(([date, pnl]) => ({ date, pnl: round2(pnl) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const periodStartBalance = D.startingBalance;
  let running = periodStartBalance;
  const equityCurve: { date: string; balance: number; cumulative_pnl: number }[] = [];
  for (const d of dailyPnl) {
    running = running.plus(d.pnl);
    equityCurve.push({
      date: d.date,
      balance: round2(running),
      cumulative_pnl: round2(running.minus(periodStartBalance)),
    });
  }

  const totalPnlUsd = running.minus(periodStartBalance);
  const totalPnlPct = periodStartBalance.isZero()
    ? 0
    : totalPnlUsd.div(periodStartBalance).times(100).toNumber();

  const wins = allTrades.filter((t) => t.win).length;
  const grossProfit = allTrades
    .filter((t) => t.pnl_usd > 0)
    .reduce((s, t) => s.plus(t.pnl_usd), D.zero);
  const grossLoss = allTrades
    .filter((t) => t.pnl_usd < 0)
    .reduce((s, t) => s.plus(t.pnl_usd), D.zero)
    .abs();
  // Profit Factor = sum(gross profits) / sum(gross losses). Zero-loss period: 999 if any profit, else 0. No NaN/infinity.
  let profitFactor: number;
  if (grossLoss.greaterThan(0)) {
    const pf = grossProfit.div(grossLoss).toNumber();
    profitFactor = Number.isFinite(pf) && pf >= 0 ? round2(pf) : 0;
  } else {
    profitFactor = grossProfit.greaterThan(0) ? 999 : 0;
  }

  const dailyReturns = dailyPnl.map((d) =>
    periodStartBalance.gt(0) ? toDecimal(d.pnl).div(periodStartBalance).toNumber() : 0
  );
  const sharpeRatio = round2(sharpeFromDailyReturns(dailyReturns));

  let peak = periodStartBalance;
  let maxDrawdown = D.zero;
  for (const point of equityCurve) {
    const bal = toDecimal(point.balance);
    if (bal.greaterThan(peak)) peak = bal;
    const dd = peak.minus(bal);
    if (dd.greaterThan(maxDrawdown)) maxDrawdown = dd;
  }
  const maxDrawdownPct = peak.greaterThan(0) ? maxDrawdown.div(peak).times(100).toNumber() : 0;
  const winRatePct = allTrades.length > 0 ? (wins / allTrades.length) * 100 : 0;

  const daysCount = Math.max(1, (new Date(toDate).getTime() - new Date(fromDate).getTime()) / (1000 * 60 * 60 * 24));
  const annualizedReturnPct = periodStartBalance.gt(0) && running.gt(0) && daysCount > 0
    ? running.div(periodStartBalance).pow(365 / daysCount).minus(1).times(100)
    : toDecimal(0);
  const calmarRatio = maxDrawdownPct > 0
    ? round2(annualizedReturnPct.div(maxDrawdownPct))
    : 0;

  const totalFeesUsd = sortedBacktests.reduce((sum, entry) => sum + tradeFeeUsd(entry), 0);

  const virtualDurations = virtualClosed
    .map((row) => virtualTradeDurationHours(row))
    .filter((h): h is number => h != null && Number.isFinite(h));
  const avgTradeDurationHours =
    virtualDurations.length > 0
      ? round2(
          virtualDurations.reduce((a, b) => a + b, 0) / virtualDurations.length
        )
      : null;

  return NextResponse.json({
    success: true,
    from_date: fromDate,
    to_date: toDate,
    total_net_pnl_usd: round2(totalPnlUsd),
    total_net_pnl_pct: round2(totalPnlPct),
    win_rate_pct: round2(winRatePct),
    profit_factor: round2(profitFactor),
    sharpe_ratio: sharpeRatio,
    max_drawdown_usd: round2(maxDrawdown),
    max_drawdown_pct: round2(maxDrawdownPct),
    annualized_return_pct: round2(annualizedReturnPct),
    calmar_ratio: calmarRatio,
    total_fees_usd: round2(totalFeesUsd),
    avg_trade_duration_hours: avgTradeDurationHours,
    equity_curve: equityCurve,
    daily_pnl: dailyPnl,
    total_trades: allTrades.length,
    backtest_trades: backtestTrades.length,
    virtual_trades: virtualTrades.length,
  });
}
