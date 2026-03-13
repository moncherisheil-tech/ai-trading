import { NextRequest, NextResponse } from 'next/server';
import { runRetrospectiveAndReport } from '@/lib/ai-retrospective';
import { sendTelegramMessage } from '@/lib/telegram';
import { APP_CONFIG } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/cron/retrospective
 * Runs the AI Retrospective Engine: scan data, optimize weights, generate Lessons Learned,
 * persist report, and send summary to Telegram. Call from cron (e.g. daily) or after 5 closed trades.
 * Optional: cron secret in body or header to protect from public calls.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return NextResponse.json({ ok: false, error: 'DB_DRIVER=sqlite required.' }, { status: 200 });
  }

  const { result, insights, reportId } = runRetrospectiveAndReport();

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
    accuracyPct: result.successRatePct,
    weightsUpdated: result.weightsUpdated,
    insights: {
      successSummary: insights.successSummary,
      keyLesson: insights.keyLesson,
      actionTaken: insights.actionTaken,
    },
  });
}
