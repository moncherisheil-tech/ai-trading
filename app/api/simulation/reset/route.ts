/**
 * POST: Clear all persisted simulation trades.
 */

import { NextResponse } from 'next/server';
import { resetSimulationTrades } from '@/lib/db/simulation-trades';
import { APP_CONFIG } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  if (!APP_CONFIG.postgresUrl?.trim()) {
    return NextResponse.json(
      { success: false, error: 'DATABASE_URL (Vercel Postgres) required.' },
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
