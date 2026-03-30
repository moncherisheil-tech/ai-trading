/**
 * @deprecated Use BullMQ repeatable jobs for automatic scheduling.
 *
 * This endpoint is now MANUAL ONLY and should NOT be called automatically.
 * Automatic scheduling is handled by setupAutoScanner() in lib/queue/queue-worker.ts
 * as a BullMQ repeatable job that triggers every 20 minutes.
 *
 * You may still call this endpoint manually for on-demand scans, but:
 * - Remove from vercel.json cron configuration
 * - Do NOT set up external cron triggers (e.g. cron-job.org) to call this
 * - The repeatable job is now idempotent and handles scheduling entirely
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { getScannerSettings } from '@/lib/db/system-settings';
import { buildCandidateList } from '@/lib/workers/market-scanner';
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
      event: 'queue.cycle_enqueued_manual',
      level: 'info',
      meta: { cycleId, count: candidates.length, symbols: candidates, source: 'manual_http_trigger' },
    });

    return NextResponse.json({
      ok: true,
      cycleId,
      enqueued: candidates.length,
      symbols: candidates,
      note: 'Manual trigger only — automatic scheduling is handled by BullMQ repeatable jobs.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Enqueue] Failed to enqueue scan cycle:', message);
    writeAudit({ event: 'queue.enqueue_failed', level: 'error', meta: { cycleId, error: message } });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
