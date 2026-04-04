/**
 * Execute Signal Route — VERIFIER ONLY (Public Key).
 *
 * RSA Architecture (Air-Gapped):
 *   This route ONLY verifies signatures using EXECUTION_RSA_PUBLIC_KEY_PEM.
 *   It MUST NEVER import signExecutionHandshake or access EXECUTION_RSA_PRIVATE_KEY.
 *   The Signer lives in the internal signal-generation service (lib/trading/execution-auth.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';
import { verifyExecutionHandshake } from '@/lib/trading/execution-auth';

type ExecuteSignalBody = {
  symbol?: string;
  side?: 'BUY' | 'SELL';
  confidence?: number;
  priority?: 'atomic' | 'standard';
  idempotencyKey?: string;
  hawkEye?: {
    highVelocityPriority?: boolean;
    liquidityGapDetected?: boolean;
    gapStrengthPct?: number;
  };
  /** CEO tactical override — bypasses AI risk sizing for this specific execution. */
  manualOverride?: {
    positionSizeUsd?: number;
    noStopLoss?: boolean;
    stopLossPct?: number;
  };
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
    const bodyRaw = await request.text();
    const handshake = verifyExecutionHandshake({
      bodyRaw,
      signatureB64: request.headers.get('x-exec-signature'),
      timestampRaw: request.headers.get('x-exec-timestamp'),
    });
    if (!handshake.ok) {
      return NextResponse.json({ success: false, error: handshake.reason ?? 'Invalid handshake' }, { status: 401 });
    }
    const body = JSON.parse(bodyRaw) as ExecuteSignalBody;
    const side = body.side;
    const confidence = Number(body.confidence);
    const symbol = normalizeSymbol(String(body.symbol ?? ''));
    const priority = body.priority === 'atomic' ? 'atomic' : 'standard';
    const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : `manual-${symbol}-${side}-${Math.round(confidence)}-${Math.floor(Date.now() / 15000)}`;
    const hawkEye = body.hawkEye ?? {};
    const manualOverride = body.manualOverride ?? undefined;

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

    const { executeAutonomousConsensusSignal } = await import('@/lib/trading/execution-engine');
    const result = await executeAutonomousConsensusSignal({
      predictionId: `manual-${symbol}-${Date.now()}`,
      idempotencyKey,
      priority,
      symbol,
      predictedDirection: side === 'BUY' ? 'Bullish' : 'Bearish',
      finalConfidence: confidence,
      consensusApproved: true,
      manualOverride,
      consensusReasoning: {
        overseerSummary: `CEO tactical override approved (${side}) via Alpha Signals dashboard${priority === 'atomic' ? ' · ATOMIC PRIORITY' : ''}${manualOverride?.positionSizeUsd != null ? ` · Size=$${manualOverride.positionSizeUsd}` : ''}${manualOverride?.noStopLoss ? ' · NO-SL' : manualOverride?.stopLossPct != null ? ` · SL=${manualOverride.stopLossPct}%` : ''}.`,
        overseerReasoningPath: 'ceo_human_in_the_loop_override',
        expertBreakdown: {
          source: 'manual_alpha_signal',
          side,
          confidence,
          priority,
          hawkEye,
          manualOverride: manualOverride ?? null,
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
