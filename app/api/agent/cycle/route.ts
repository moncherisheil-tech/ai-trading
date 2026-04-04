import { NextResponse } from 'next/server';
import { runAgentCycle } from '@/lib/simulation-service';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/agent/cycle
 * Runs one Smart Agent cycle: opens virtual trades for Elite (עוצמתי) gems that don't have an open position.
 */
export async function POST(request: Request) {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { opened, message } = await runAgentCycle(5);
    return NextResponse.json({ success: true, opened, message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Agent cycle failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
