import { NextRequest, NextResponse } from 'next/server';
import { listBacktests, type BacktestLogEntry } from '@/lib/db/backtest-repository';
import { listStrategyInsights } from '@/lib/db/strategy-repository';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

const CORRECT_OUTCOMES = new Set<string>(['bullish_win', 'bearish_win', 'neutral_win']);

function isCorrect(entry: BacktestLogEntry): boolean {
  return CORRECT_OUTCOMES.has(entry.outcome_label);
}

function getDateKey(isoString: string): string {
  return isoString.slice(0, 10);
}

export async function GET(request: NextRequest) {
  if (!isSessionEnabled()) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value || '';
  const session = verifySessionToken(token);
  if (!session || !hasRequiredRole(session.role, 'admin')) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const backtests = await listBacktests();
  const insights = await listStrategyInsights();

  const byDate = new Map<
    string,
    { total: number; correct: number; sumAbsoluteError: number }
  >();

  for (const entry of backtests) {
    const key = getDateKey(entry.evaluated_at);
    const bucket = byDate.get(key) ?? { total: 0, correct: 0, sumAbsoluteError: 0 };
    bucket.total += 1;
    if (isCorrect(entry)) bucket.correct += 1;
    bucket.sumAbsoluteError += entry.absolute_error_pct;
    byDate.set(key, bucket);
  }

  const timeSeries = Array.from(byDate.entries())
    .map(([date, agg]) => ({
      date,
      avgErrorPct: agg.total > 0 ? Math.round((agg.sumAbsoluteError / agg.total) * 100) / 100 : 0,
      accuracyPct: agg.total > 0 ? Math.round((agg.correct / agg.total) * 10000) / 100 : 0,
      total: agg.total,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalBacktests = backtests.length;
  const totalCorrect = backtests.filter(isCorrect).length;
  const currentAccuracyPct =
    totalBacktests > 0 ? Math.round((totalCorrect / totalBacktests) * 10000) / 100 : 0;

  const approved = insights.filter((i) => i.status === 'approved');
  const lastLearningCycleDate =
    insights.length > 0
      ? insights.reduce((max, i) => (i.created_at > max ? i.created_at : max), insights[0].created_at)
      : null;

  return NextResponse.json({
    success: true,
    timeSeries,
    totalBacktests,
    currentAccuracyPct,
    totalStrategiesApproved: approved.length,
    lastLearningCycleDate,
  });
}
