/**
 * Cron: Daily Pulse (v1.4) — 21:59 UTC daily.
 * Sends Smart Money v1.4 summary to Telegram: PnL, learning delta, insight, Sentinel.
 * Authorization: CRON_SECRET (Bearer or query secret=).
 */

import { NextResponse } from 'next/server';
import { runDailyReportTask } from '@/lib/workers/daily-report-task';
import { validateCronAuth } from '@/lib/cron-auth';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { ok, error } = await runDailyReportTask();
    if (ok) return NextResponse.json({ ok: true, message: 'סיכום יומי נשלח' });
    console.error('[Cron daily-report]', error);
    await sendWorkerFailureAlert('daily-report', error ?? 'Unknown error');
    return NextResponse.json({ ok: false, error: error ?? 'Unknown error' }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron daily-report]', message);
    await sendWorkerFailureAlert('daily-report', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
