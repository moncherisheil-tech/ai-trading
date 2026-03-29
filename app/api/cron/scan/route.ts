/**
 * Secured GET endpoint for Vercel Cron or external cron (e.g. cron-job.org).
 *
 * Routing logic:
 *   QUEUE_ENABLED=true  → fire-and-forget to /api/cron/enqueue (BullMQ path)
 *   QUEUE_ENABLED=false → fire-and-forget to /api/cron/worker  (legacy path, default)
 *
 * Returns immediately (~100ms); actual work happens asynchronously.
 * Authorization: CRON_SECRET or ADMIN_SECRET (Bearer header or x-cron-secret).
 * Scanner on/off is enforced in the downstream handler.
 */

import { NextResponse } from 'next/server';
import { getAuthorizedToken } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const useQueue = process.env.QUEUE_ENABLED === 'true';
  const targetPath = useQueue ? '/api/cron/enqueue' : '/api/cron/worker';
  const targetUrl = new URL(targetPath, request.url);

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 50);
  fetch(targetUrl.toString(), {
    signal: ac.signal,
    headers: { Authorization: `Bearer ${token}` },
  })
    .catch(() => {})
    .finally(() => clearTimeout(timeoutId));

  const origin = new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/cron-success`, 302);
}
