/**
 * Execute Signal Route — VERIFIER ONLY (Public Key).
 *
 * RSA Architecture (Air-Gapped):
 *   This route ONLY verifies signatures using EXECUTION_RSA_PUBLIC_KEY_PEM.
 *   It MUST NEVER import signExecutionHandshake or access EXECUTION_RSA_PRIVATE_KEY.
 *   The Signer lives in the internal signal-generation service (lib/trading/execution-auth.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';
import { verifyExecutionHandshake } from '@/lib/trading/execution-auth';

// ---------------------------------------------------------------------------
// Runtime schema — validates every byte of the incoming signal payload before
// any execution logic runs. TypeScript types alone provide zero runtime safety.
// ---------------------------------------------------------------------------
const ExecuteSignalSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,20}(USDT)?$/, 'Invalid symbol format')
    .max(25),
  side: z.enum(['BUY', 'SELL']),
  confidence: z.number().finite().min(0).max(100),
  priority: z.enum(['atomic', 'standard']).optional().default('standard'),
  idempotencyKey: z.string().max(128).optional(),
  hawkEye: z
    .object({
      highVelocityPriority: z.boolean().optional(),
      liquidityGapDetected: z.boolean().optional(),
      gapStrengthPct: z.number().finite().min(0).max(100).optional(),
    })
    .optional(),
  manualOverride: z
    .object({
      // Hard-capped at $50 — mirrors the Protocol Omega engine constant.
      positionSizeUsd: z.number().finite().positive().max(50).optional(),
      noStopLoss: z.boolean().optional(),
      stopLossPct: z.number().finite().min(0).max(100).optional(),
    })
    .optional(),
});

type ExecuteSignalBody = z.infer<typeof ExecuteSignalSchema>;

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
    let body: ExecuteSignalBody;
    try {
      const parsed = JSON.parse(bodyRaw);
      const result = ExecuteSignalSchema.safeParse(parsed);
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: 'Payload validation failed.', details: result.error.flatten().fieldErrors },
          { status: 400 }
        );
      }
      body = result.data;
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON payload.' }, { status: 400 });
    }

    const side = body.side;
    const confidence = body.confidence;
    const symbol = normalizeSymbol(body.symbol);
    const priority = body.priority ?? 'standard';
    const idempotencyKey = body.idempotencyKey?.trim()
      ?? `manual-${symbol}-${side}-${Math.round(confidence)}-${Math.floor(Date.now() / 15000)}`;
    const hawkEye = body.hawkEye ?? {};
    const manualOverride = body.manualOverride ?? undefined;

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
