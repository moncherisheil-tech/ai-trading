/**
 * Secured GET endpoint for Vercel Cron Jobs.
 * Triggers one market scanner cycle (fetch gems, run AI analysis, send high-confidence alerts).
 * Authorization: CRON_SECRET or WORKER_CRON_SECRET (Bearer token or query param).
 */

import { NextResponse } from 'next/server';
import { runOneCycle } from '@/lib/workers/market-scanner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET || process.env.WORKER_CRON_SECRET || '';
  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const url = new URL(request.url);
  const querySecret = url.searchParams.get('secret') || '';

  const provided = bearer || querySecret;
  if (!cronSecret || provided !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await runOneCycle();
    return NextResponse.json({ ok: true, message: 'סריקה הושלמה' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron scan]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
