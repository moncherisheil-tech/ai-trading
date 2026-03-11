import { NextRequest, NextResponse } from 'next/server';
import { isAllowedIp } from '@/lib/security';
import { runLearningFromBacktests } from '@/lib/agents/learning-agent';

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

  const result = await runLearningFromBacktests();
  return NextResponse.json({ success: true, ...result });
}

