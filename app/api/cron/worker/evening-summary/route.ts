/**
 * Internal worker for evening summary. Called by /api/cron/evening-summary via fire-and-forget.
 * Aggregates day data and runs conclusion drawing (learning from backtests). Auth: CRON_SECRET.
 * Node runtime only: heavy imports (DB, AI) stay here.
 */

import { NextResponse } from 'next/server';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { runEveningSummary } from '@/lib/workers/evening-summary';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request): Promise<NextResponse> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runEveningSummary();
    if (result.ok) {
      return NextResponse.json({
        ok: true,
        message: 'סיכום ערב הושלם',
        insightsCreated: result.insightsCreated,
        alertsLast24h: result.alertsLast24h,
        ledgerRows: result.ledgerRows,
        closedLoopSamples: result.closedLoopSamples,
        closedLoopAccuracyScore: result.closedLoopAccuracyScore,
        fearGreedValue: result.fearGreedValue,
        fearGreedClassification: result.fearGreedClassification,
        rssHeadlinesUsed: result.rssHeadlinesUsed,
        overseerVerdict: result.overseerVerdict,
      });
    }
    console.error('[Cron worker evening-summary] failed:', result.error);
    await sendWorkerFailureAlert('evening-summary.worker', result.error ?? 'Unknown error');
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron worker evening-summary]', message);
    await sendWorkerFailureAlert('evening-summary.worker', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
