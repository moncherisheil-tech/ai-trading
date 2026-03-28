/**
 * POST: Floor 1000 DB sanitization (demo markers + absurd prices).
 * Auth: Bearer ADMIN_SECRET or x-cron-secret CRON_SECRET.
 */

import { NextResponse } from 'next/server';
import { runSanitizeFloor1000 } from '@/lib/db/sanitize-floor1000';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runSanitizeFloor1000();
    if (!result.ok && result.skipped === 'postgres_not_configured') {
      return NextResponse.json(
        { ...result, error: 'Database not configured' },
        { status: 503 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error('[sanitize-floor1000] failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { ok: false, error: 'Sanitization failed. Check server logs.' },
      { status: 500 }
    );
  }
}
