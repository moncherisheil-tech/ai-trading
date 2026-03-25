/**
 * POST /api/ops/trigger-retrospective
 * Frontend-triggered run of the AI Retrospective Engine.
 * Auth: valid app_auth_token cookie + admin role (no CRON_SECRET).
 */

import { NextRequest, NextResponse } from 'next/server';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { runRetrospectiveAndReport } from '@/lib/ai-retrospective';
import { sendTelegramMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const token = request.cookies.get('app_auth_token')?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const { result, insights, reportId, ledgerSynced } = await runRetrospectiveAndReport();

    const telegramText = [
      '📊 <b>דוח למידה יומי — מנוע רטרוספקטיבה</b>',
      '',
      insights.successSummary,
      '',
      '<b>תובנה:</b> ' + insights.keyLesson,
      '',
      '<b>פעולה:</b> ' + insights.actionTaken,
    ].join('\n');

    await sendTelegramMessage(telegramText, { parse_mode: 'HTML' });

    return NextResponse.json({
      ok: true,
      reportId,
      ledgerSynced,
      accuracyPct: result.successRatePct,
      weightsUpdated: result.weightsUpdated,
      insights: {
        successSummary: insights.successSummary,
        keyLesson: insights.keyLesson,
        actionTaken: insights.actionTaken,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
