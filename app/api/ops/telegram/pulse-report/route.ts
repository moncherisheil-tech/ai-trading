import { NextResponse } from 'next/server';
import { sendDailyPulseReport } from '@/lib/ops/telegram-reporter';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sendDailyPulseReport();
    if (result.ok) {
      return NextResponse.json({ ok: true, message: 'Hedge Fund Pulse report sent to Telegram.' });
    }
    return NextResponse.json(
      { ok: false, error: result.error ?? 'Unknown error' },
      { status: 500 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

