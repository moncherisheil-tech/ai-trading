/**
 * Enqueue Scan Cycle — replaces the fire-and-forget /api/cron/worker chain.
 *
 * Fetches coin candidates (same logic as market-scanner.ts) and enqueues
 * one BullMQ job per candidate. Returns immediately — the Worker process
 * runs the jobs in the background.
 *
 * Authorization: same CRON_SECRET / ADMIN_SECRET as existing routes.
 * Only active when QUEUE_ENABLED=true.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { getScannerSettings } from '@/lib/db/system-settings';
import { buildCandidateList, buildCycleMacroContext } from '@/lib/workers/market-scanner';
import { enqueueScanCycle } from '@/lib/queue/scan-queue';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: Request): Promise<NextResponse> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.QUEUE_ENABLED !== 'true') {
    return NextResponse.json({ ok: false, error: 'Queue not enabled. Set QUEUE_ENABLED=true.' }, { status: 400 });
  }

  const settings = await getScannerSettings();
  if (settings && !settings.scanner_is_active) {
    return NextResponse.json({ ok: true, status: 'disabled', message: 'הסורק כבוי בהגדרות' });
  }

  const cycleId = randomUUID();

  try {
    const { candidates, macroCtx } = await buildCandidateList();

    if (candidates.length === 0) {
      writeAudit({ event: 'queue.enqueue_empty', level: 'warn', meta: { cycleId } });
      return NextResponse.json({ ok: true, cycleId, enqueued: 0, message: 'No candidates found' });
    }

    await enqueueScanCycle(candidates, cycleId, macroCtx);

    writeAudit({
      event: 'queue.cycle_enqueued',
      level: 'info',
      meta: { cycleId, count: candidates.length, symbols: candidates },
    });

    return NextResponse.json({
      ok: true,
      cycleId,
      enqueued: candidates.length,
      symbols: candidates,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Enqueue] Failed to enqueue scan cycle:', message);
    writeAudit({ event: 'queue.enqueue_failed', level: 'error', meta: { cycleId, error: message } });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
