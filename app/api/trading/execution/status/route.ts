import { NextRequest, NextResponse } from 'next/server';
import { getAppSettings, setAppSettings } from '@/lib/db/app-settings';
import { getExecutionDashboardSnapshot } from '@/lib/trading/execution-engine';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clampPct(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export async function GET(): Promise<NextResponse> {
  try {
    const snapshot = await getExecutionDashboardSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load execution dashboard.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    masterSwitchEnabled?: boolean;
    mode?: 'PAPER' | 'LIVE';
    minConfidenceToExecute?: number;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload.' }, { status: 400 });
  }

  try {
    const current = await getAppSettings();
    const currentExecution = current.execution;
    const requestedMode = body.mode === 'LIVE' || body.mode === 'PAPER' ? body.mode : currentExecution.mode;
    const liveLocked = !currentExecution.liveApiKeyConfigured;
    const mode = requestedMode === 'LIVE' && liveLocked ? 'PAPER' : requestedMode;
    const partial = {
      execution: {
        masterSwitchEnabled:
          typeof body.masterSwitchEnabled === 'boolean'
            ? body.masterSwitchEnabled
            : currentExecution.masterSwitchEnabled,
        mode,
        minConfidenceToExecute:
          body.minConfidenceToExecute != null
            ? clampPct(body.minConfidenceToExecute, currentExecution.minConfidenceToExecute)
            : currentExecution.minConfidenceToExecute,
        liveApiKeyConfigured: currentExecution.liveApiKeyConfigured,
      },
    };
    const result = await setAppSettings(partial);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    const snapshot = await getExecutionDashboardSnapshot();
    return NextResponse.json({
      ok: true,
      liveLocked,
      modeApplied: snapshot.mode,
      snapshot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update execution settings.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
