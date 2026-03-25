/**
 * 20-minute market scanner cron. Secured by CRON_SECRET.
 * Calls market-scanner runOneCycle(); respects scanner_is_active.
 * Authorization: Bearer or query param ?secret=.
 */

import { NextResponse } from 'next/server';
import { getScannerSettings, setLastScanTimestamp } from '@/lib/db/system-settings';
import { runOneCycle } from '@/lib/workers/market-scanner';
import { getAuthorizedToken } from '@/lib/cron-auth';
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
    await runOneCycle();
    await setLastScanTimestamp(now);
    return NextResponse.json({ ok: true, message: 'סריקה הושלמה' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron scanner] Error:', message);
    await sendWorkerFailureAlert('scanner.cron', err);
    await setLastScanTimestamp(now).catch(() => {});
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
