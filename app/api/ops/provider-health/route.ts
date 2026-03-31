/**
 * GET /api/ops/provider-health
 *
 * Returns the LIVE in-memory provider health snapshot from the current process.
 * This is NOT a DB lookup — it reads the rolling window tracked by consensus-engine.ts.
 *
 * Unlike /api/ops/health (which checks env-key presence and calls resetProviderHealthWindows),
 * this endpoint returns the real-time model-watchdog status so the UI can show whether
 * Gemini/Groq are currently healthy WITHOUT relying on stale expert_breakdown_json blobs
 * stored in virtual_trade_history.
 *
 * Deliberately lightweight (no external I/O) — safe to poll every 15 seconds.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getProviderHealthSnapshot } from '@/lib/consensus-engine';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const snapshot = getProviderHealthSnapshot();

  return NextResponse.json({
    gemini: snapshot.gemini,
    groq: snapshot.groq,
    // Convenience flag: true when both providers are at least "degraded" or better.
    anyProviderHealthy: snapshot.gemini.status !== 'unstable' || snapshot.groq.status !== 'unstable',
    timestamp: new Date().toISOString(),
  });
}
