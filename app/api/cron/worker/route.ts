/**
 * Internal worker for market scanner. Called by /api/cron/scan via fire-and-forget fetch.
 * Runs runOneCycle() and has its own 60s execution clock (avoids 10s timeout on trigger).
 * Authorization: CRON_SECRET (Bearer or query secret=), same normalization as scanner. Respects scanner_is_active.
 */

import { NextResponse } from 'next/server';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { getScannerSettings, setLastScanTimestamp } from '@/lib/db/system-settings';
import { runOneCycle } from '@/lib/workers/market-scanner';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await getScannerSettings();
  if (settings && !settings.scanner_is_active) {
    return NextResponse.json({ ok: true, status: 'disabled', message: 'הסורק כבוי בהגדרות' });
  }

  const now = Date.now();
  try {
    try {
      await runOneCycle();
    } catch (firstErr) {
      // Self-healing retry: one immediate second attempt for transient upstream failures.
      console.warn('[Cron worker] First scan attempt failed, retrying once:', firstErr);
      await runOneCycle();
    }
    await setLastScanTimestamp(now);
    return NextResponse.json({ ok: true, message: 'סריקה הושלמה' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron worker] Error:', message);
    await sendWorkerFailureAlert('scanner.worker', err);
    await setLastScanTimestamp(now).catch(() => {});
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
