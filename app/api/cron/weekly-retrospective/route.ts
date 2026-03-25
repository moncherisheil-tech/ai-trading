/**
 * Cron: Weekly AI Retrospective (CEO Saturday Report) — Saturday 21:00.
 * Sends detailed analysis: top symbol, lessons learned, calibration recommendations.
 * Authorization: CRON_SECRET (Bearer or query secret=).
 */

import { NextResponse } from 'next/server';
import { runWeeklyRetrospectiveTask } from '@/lib/workers/weekly-retrospective-task';
import { validateCronAuth } from '@/lib/cron-auth';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { ok, error } = await runWeeklyRetrospectiveTask();
    if (ok) return NextResponse.json({ ok: true, message: 'דוח CEO שבועי נשלח' });
    console.error('[Cron weekly-retrospective]', error);
    await sendWorkerFailureAlert('weekly-retrospective', error ?? 'Unknown error');
    return NextResponse.json({ ok: false, error: error ?? 'Unknown error' }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron weekly-retrospective]', message);
    await sendWorkerFailureAlert('weekly-retrospective', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
