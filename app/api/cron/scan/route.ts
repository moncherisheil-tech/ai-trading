/**
 * @deprecated Use BullMQ repeatable jobs instead.
 *
 * This endpoint is NO LONGER ACTIVE and should be removed from your Vercel Cron configuration.
 * The market scanner now runs as a repeatable BullMQ job in the PM2 queue worker,
 * triggered every 20 minutes from setupAutoScanner() in lib/queue/queue-worker.ts.
 *
 * Remove from vercel.json:
 *   { "path": "/api/cron/scan", "schedule": "* / 20 * * * *" }
 *
 * No external HTTP trigger is needed anymore.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  console.warn('[Deprecated] GET /api/cron/scan called. This route is no longer active.');
  return NextResponse.json(
    {
      deprecated: true,
      message: 'This endpoint is deprecated. Remove from vercel.json.',
      details: 'Use BullMQ repeatable jobs (setupAutoScanner) instead.',
    },
    { status: 410 }
  );
}
