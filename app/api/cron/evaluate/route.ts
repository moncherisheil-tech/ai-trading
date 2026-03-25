/**
 * Cron: Learning loop — evaluate pending predictions so the AI learns from outcomes.
 * Calls evaluatePendingPredictions({ internalWorker: true }).
 * Schedule: daily (e.g. 22:00 UTC). Authorization: CRON_SECRET (Bearer or query secret=).
 */

import { NextResponse } from 'next/server';
import { evaluatePendingPredictions } from '@/app/actions';
import { validateCronAuth } from '@/lib/cron-auth';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await evaluatePendingPredictions({ internalWorker: true });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron evaluate] Error:', message);
    await sendWorkerFailureAlert('evaluate', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
