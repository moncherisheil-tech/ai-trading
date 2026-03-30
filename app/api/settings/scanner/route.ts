/**
 * GET: Read scanner settings (scanner_is_active, last_scan_timestamp).
 * POST: Update scanner_is_active (admin only).
 */

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getScannerSettings, setScannerActive } from '@/lib/db/system-settings';
import { getScannerState } from '@/lib/workers/market-scanner';
import { countScannerAlertsToday } from '@/lib/db/scanner-alert-log';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const [settings, state, gemsToday] = await Promise.all([
    getScannerSettings(),
    Promise.resolve(getScannerState()),
    countScannerAlertsToday(),
  ]);

  const scanner_is_active = settings?.scanner_is_active ?? true;
  const last_scan_timestamp = settings?.last_scan_timestamp ?? null;
  const lastScanTime =
    last_scan_timestamp != null
      ? new Date(last_scan_timestamp).toISOString()
      : state.lastScanTime;

  return NextResponse.json({
    scanner_is_active,
    last_scan_timestamp: last_scan_timestamp,
    last_scan_time_iso: lastScanTime,
    status: state.status,
    last_run_stats: state.lastRunStats,
    last_diagnostics: state.lastDiagnostics,
    gems_found_today: gemsToday,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: { scanner_is_active?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.scanner_is_active !== 'boolean') {
    return NextResponse.json({ error: 'scanner_is_active must be boolean' }, { status: 400 });
  }

  try {
    const result = await setScannerActive(body.scanner_is_active);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error ?? 'Failed to update scanner settings' },
        { status: 503 }
      );
    }
    revalidatePath('/settings');
    revalidatePath('/');
    return NextResponse.json({ ok: true, scanner_is_active: body.scanner_is_active });
  } catch (e) {
    console.error('[SAVE_ERROR] settings/scanner POST', e);
    const message = e instanceof Error ? e.message : 'Failed to update scanner settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
