/**
 * Secured GET endpoint for Vercel Cron or external cron (e.g. cron-job.org).
 * Returns immediately via redirect to /cron-success (~100ms); triggers actual scan via
 * fire-and-forget fetch to /api/cron/worker with 50ms timeout so the main function can close.
 * Node runtime is sufficient here because the route exits immediately after dispatching the worker fetch.
 * Authorization: CRON_SECRET (Bearer or query secret=).
 * Scanner on/off is enforced in the worker; this route only validates auth and triggers.
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

  const workerUrl = new URL('/api/cron/worker', request.url);
  workerUrl.searchParams.set('secret', token);

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 50);
  fetch(workerUrl.toString(), { signal: ac.signal })
    .catch(() => {})
    .finally(() => clearTimeout(timeoutId));

  const origin = new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/cron-success`, 302);
}
