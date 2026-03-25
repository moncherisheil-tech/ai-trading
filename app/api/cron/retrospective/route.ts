import { NextRequest, NextResponse } from 'next/server';
import { runRetrospectiveAndReport } from '@/lib/ai-retrospective';
import { sendTelegramMessage, getDashboardReportKeyboard } from '@/lib/telegram';
import { getBaseUrl } from '@/lib/config';
import { validateCronAuth } from '@/lib/cron-auth';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/cron/retrospective
 * Runs the AI Retrospective Engine: scan data, optimize weights, generate Lessons Learned,
 * persist report, and send summary to Telegram. Call from cron (e.g. daily) or after 5 closed trades.
 * Authorization: CRON_SECRET via shared normalize+validate logic.
 */

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    const telegramResult = await sendTelegramMessage(telegramText, {
      parse_mode: 'HTML',
      reply_markup: getDashboardReportKeyboard(getBaseUrl()),
    });
    if (!telegramResult.ok) {
      console.warn('[Cron retrospective] Telegram send failed:', telegramResult.error);
    }

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
    console.error('[Cron retrospective] Error:', message);
    await sendWorkerFailureAlert('retrospective', err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
