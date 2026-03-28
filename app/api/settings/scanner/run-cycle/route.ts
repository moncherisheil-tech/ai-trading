/**
 * Admin-only POST: run one market-scanner cycle (same as cron scanner).
 * Does not run automatically on settings save. Vercel maxDuration may cap long scans.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getScannerSettings, setLastScanTimestamp } from '@/lib/db/system-settings';
import { runOneCycle } from '@/lib/workers/market-scanner';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get('app_auth_token')?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const settings = await getScannerSettings();
  if (settings && !settings.scanner_is_active) {
    return NextResponse.json({
      ok: true,
      status: 'disabled' as const,
      message: 'הסורק כבוי בהגדרות — הפעל את הסורק לפני הרצה ידנית.',
    });
  }

  const now = Date.now();
  try {
    try {
      await runOneCycle();
    } catch (firstErr) {
      console.warn('[Run cycle] First attempt failed, retrying once:', firstErr);
      await runOneCycle();
    }
    await setLastScanTimestamp(now);
    return NextResponse.json({ ok: true, message: 'סריקה הושלמה בהצלחה.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Run cycle] Error:', message);
    await sendWorkerFailureAlert('scanner.run_cycle', err);
    await setLastScanTimestamp(now).catch(() => {});
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
