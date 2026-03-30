/**
 * GET /api/ops/calibrate
 * Runs the Autonomous Calibration Engine (sensitivity analysis over last 14 days),
 * returns actionable recommendations and market context for parameter optimization.
 * Auth: same as other ops routes (admin when session enabled).
 */

import { NextRequest, NextResponse } from 'next/server';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { runSensitivityAnalysis } from '@/lib/optimizer';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 14);
    const fromDate = from.toISOString().slice(0, 10) + 'T00:00:00.000Z';
    const toDate = to.toISOString().slice(0, 10) + 'T23:59:59.999Z';

    const result = await runSensitivityAnalysis(fromDate, toDate);

    return NextResponse.json({
      success: true,
      ...result,
      /** Expert logic: market context flag and recommendation. */
      market_context: result.marketContext,
      recommendation: result.recommendation_he,
      market_context_note: result.marketContextNote_he,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/ops/calibrate]', message);
    return NextResponse.json(
      { success: false, error: message, recommendation_he: '' },
      { status: 500 }
    );
  }
}
