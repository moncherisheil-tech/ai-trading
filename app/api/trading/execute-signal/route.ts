import { NextRequest, NextResponse } from 'next/server';
import { executeAutonomousConsensusSignal } from '@/lib/trading/execution-engine';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';

type ExecuteSignalBody = {
  symbol?: string;
  side?: 'BUY' | 'SELL';
  confidence?: number;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeSymbol(raw: string): string {
  const clean = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.endsWith('USDT') ? clean : `${clean}USDT`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ExecuteSignalBody;
    const side = body.side;
    const confidence = Number(body.confidence);
    const symbol = normalizeSymbol(String(body.symbol ?? ''));

    if (!symbol || !['BUY', 'SELL'].includes(String(side))) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload. Expected symbol and side BUY/SELL.' },
        { status: 400 }
      );
    }

    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      return NextResponse.json(
        { success: false, error: 'Invalid confidence. Expected numeric value between 0 and 100.' },
        { status: 400 }
      );
    }

    const result = await executeAutonomousConsensusSignal({
      predictionId: `manual-${symbol}-${Date.now()}`,
      symbol,
      predictedDirection: side === 'BUY' ? 'Bullish' : 'Bearish',
      finalConfidence: confidence,
      consensusApproved: true,
      consensusReasoning: {
        overseerSummary: `Manual override approved by operator (${side}) via Alpha Signals dashboard.`,
        overseerReasoningPath: 'human_in_the_loop_override',
        expertBreakdown: {
          source: 'manual_alpha_signal',
          side,
          confidence,
        },
      },
    });

    const ok = result.executed && result.status === 'executed';
    return NextResponse.json({
      success: ok,
      data: result,
      message: ok ? 'Signal deployed for execution.' : result.reason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to execute manual signal.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
