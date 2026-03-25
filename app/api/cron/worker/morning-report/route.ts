/**
 * Internal worker for morning report. Called by /api/cron/morning-report via fire-and-forget.
 * Runs runMorningReport() (market summary, Telegram). Auth: CRON_SECRET (Bearer or query secret=).
 * Node runtime only: heavy imports (Telegram, DB, AI) stay here.
 */

import { NextResponse } from 'next/server';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { runMorningReport } from '@/lib/workers/daily-reporter';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { ok, error } = await runMorningReport();
    if (ok) {
      console.log('[Cron worker morning-report] Telegram message sent successfully.');
      return NextResponse.json({ ok: true, message: 'דוח בוקר נשלח' });
    }
    console.error('[Cron worker morning-report] Telegram send failed:', error);
    await sendWorkerFailureAlert('morning-report.worker', error ?? 'Unknown error');
    return NextResponse.json({ ok: false, error: error ?? 'Unknown error' }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron worker morning-report]', message);
    await sendWorkerFailureAlert('morning-report.worker', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
