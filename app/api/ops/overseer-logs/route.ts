/**
 * GET /api/ops/overseer-logs — Recent Overseer (Supreme Inspector) consensus logs.
 * Returns last N predictions with master_insight_he, final_confidence for the CEO panel.
 * Requires admin when session enabled.
 */

import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

const MAX_LOGS = 20;

export async function GET(): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const rows = await getDbAsync();
    const logs = rows
      .filter((r) => r.master_insight_he != null || r.final_confidence != null)
      .slice(0, MAX_LOGS)
      .map((r) => ({
        symbol: r.symbol,
        master_insight_he: r.master_insight_he ?? null,
        final_confidence: r.final_confidence ?? null,
        prediction_date: r.prediction_date,
        consensus_approved: r.final_confidence != null && r.final_confidence >= 75,
        debate_resolution: r.debate_resolution?.trim() ? r.debate_resolution.trim() : null,
        tech_score: r.tech_score ?? null,
        risk_score: r.risk_score ?? null,
        psych_score: r.psych_score ?? null,
        macro_score: r.macro_score ?? null,
        onchain_score: r.onchain_score ?? null,
        deep_memory_score: r.deep_memory_score ?? null,
        predicted_direction: r.predicted_direction ?? null,
      }));
    return NextResponse.json({ logs });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load overseer logs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
