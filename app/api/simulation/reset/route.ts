/**
 * POST: Clear all persisted simulation trades.
 */

import { NextResponse } from 'next/server';
import { resetSimulationTrades } from '@/lib/db/simulation-trades';
import { APP_CONFIG } from '@/lib/config';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!APP_CONFIG.postgresUrl?.trim()) {
    return NextResponse.json(
      { success: false, error: 'DATABASE_URL (Quantum Core DB) required.' },
      { status: 400 }
    );
  }
  try {
    await resetSimulationTrades();
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to reset.';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
