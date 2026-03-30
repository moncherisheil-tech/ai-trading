/**
 * Learning accuracy time series (v1.4) — daily_accuracy_stats for Learning Progress chart.
 * GET /api/ops/metrics/learning-accuracy?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 * Returns prediction_accuracy_score and win_rate over time (agent vs actual PnL).
 */

import { NextRequest, NextResponse } from 'next/server';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getDailyAccuracyStatsInRange } from '@/lib/db/learning-metrics';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

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

  const end = toDate ? new Date(toDate) : new Date();
  const start = fromDate ? new Date(fromDate) : new Date(end);
  start.setDate(start.getDate() - 90);
  const fromStr = start.toISOString().slice(0, 10);
  const toStr = end.toISOString().slice(0, 10);

  const rows = await getDailyAccuracyStatsInRange(fromStr, toStr);

  return NextResponse.json({
    success: true,
    from_date: fromStr,
    to_date: toStr,
    data: rows.map((r) => ({
      date: r.stat_date,
      win_rate: r.win_rate,
      prediction_accuracy_score: r.prediction_accuracy_score,
      learning_delta: r.learning_delta,
    })),
  });
}
