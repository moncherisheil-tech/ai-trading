import { NextRequest, NextResponse } from 'next/server';
import { evaluatePendingPredictions } from '@/app/actions';
import { isAllowedIp } from '@/lib/security';

export async function POST(request: NextRequest) {
  if (!isAllowedIp(request)) {
    return NextResponse.json({ success: false, error: 'IP is not allowed.' }, { status: 403 });
  }

  const secret = process.env.WORKER_CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized worker request.' }, { status: 401 });
    }
  }

  const result = await evaluatePendingPredictions({ internalWorker: true });
  return NextResponse.json(result);
}
