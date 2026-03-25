/**
 * Secured GET endpoint for Vercel Cron or external cron: Executive Morning Report (08:00).
 * Returns immediately; triggers worker via native fetch.
 * Auth: CRON_SECRET (Bearer or query secret=), inline string comparison only.
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

  const workerUrl = new URL('/api/cron/worker/morning-report', request.url);
  workerUrl.searchParams.set('secret', token);

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 50);
  fetch(workerUrl.toString(), { signal: ac.signal })
    .catch(() => {})
    .finally(() => clearTimeout(timeoutId));

  return NextResponse.json({ ok: true, status: 'generating_morning_report' });
}
