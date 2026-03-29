/**
 * Queue Status API
 * Returns live BullMQ queue health counters and circuit breaker states.
 * Authorization: ADMIN_SECRET or CRON_SECRET.
 */

import { NextResponse } from 'next/server';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { getQueueCounts, getActiveCycleId } from '@/lib/queue/scan-queue';
import { getAllCircuitBreakerStates } from '@/lib/queue/circuit-breaker';
import { isRedisAvailable } from '@/lib/queue/redis-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isRedisAvailable()) {
    return NextResponse.json({
      queueEnabled: false,
      message: 'REDIS_URL not set — queue mode inactive.',
    });
  }

  try {
    const [counts, circuitBreakers, activeCycleId] = await Promise.all([
      getQueueCounts(),
      getAllCircuitBreakerStates(),
      getActiveCycleId(),
    ]);

    return NextResponse.json({
      queueEnabled: process.env.QUEUE_ENABLED === 'true',
      activeCycleId,
      queue: counts,
      circuitBreakers,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
