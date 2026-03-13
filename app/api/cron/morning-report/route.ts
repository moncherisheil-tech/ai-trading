/**
 * Secured GET endpoint for Vercel Cron: Executive Morning Report.
 * Sends daily Telegram summary (Fear & Greed, BTC dominance, active strategy, gems in 24h).
 * Schedule: 08:00 daily (e.g. 0 8 * * * or 0 6 * * * for Israel UTC+2).
 * Authorization: CRON_SECRET or WORKER_CRON_SECRET (Bearer or query param).
 */

import { NextResponse } from 'next/server';
import { runMorningReport } from '@/lib/workers/daily-reporter';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  const { ok, error } = await runMorningReport();
  if (ok) return NextResponse.json({ ok: true, message: 'דוח בוקר נשלח' });
  console.error('[Cron morning-report]', error);
  return NextResponse.json({ ok: false, error: error ?? 'Unknown error' }, { status: 500 });
}
