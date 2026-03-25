/**
 * Daily Pulse (v1.4): Telegram summary at 23:59.
 * Smart Money v1.4 — PnL יומי, שיפור בדיוק למידה, תובנה יומית, מצב Sentinel.
 * Uses Decimal.js for all percentages; RTL-friendly formatting for Hebrew.
 */

import Decimal from 'decimal.js';
import { listClosedVirtualTradesInRange } from '@/lib/db/virtual-portfolio';
import { calculateDailyAccuracyDelta } from '@/lib/db/learning-metrics';
import { getLatestLearningReports } from '@/lib/db/learning-reports';
import { getMarketRiskSentiment } from '@/lib/market-sentinel';
import { sendTelegramMessage, getDashboardReportKeyboard } from '@/lib/telegram';
import { toDecimal, round2, D } from '@/lib/decimal';
import { getBaseUrl } from '@/lib/config';

/** Reference capital for % calculations — same as simulation initial wallet (lib/decimal). */
const REFERENCE_CAPITAL = D.startingBalance.toNumber();
const RTL_MARK = '\u200F';

function formatDateHe(date: Date): string {
  return date.toLocaleDateString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Runs the Daily Pulse task: computes today's PnL, learning delta, insight, Sentinel; sends to Telegram.
 * Schedule: 23:59 daily (cron).
 */
export async function runDailyReportTask(): Promise<{ ok: boolean; error?: string }> {
  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    const [closedToday, accuracyResult, reports, marketRisk] = await Promise.all([
      listClosedVirtualTradesInRange(dayStart, dayEnd),
      calculateDailyAccuracyDelta(dateStr),
      getLatestLearningReports(1),
      getMarketRiskSentiment(),
    ]);

    const totalPnlUsd = closedToday.reduce((sum, t) => {
      if (t.pnl_pct == null) return sum;
      return sum.plus(toDecimal(t.amount_usd).times(t.pnl_pct).div(100));
    }, toDecimal(0));
    const dailyPnlPct = REFERENCE_CAPITAL > 0
      ? totalPnlUsd.div(REFERENCE_CAPITAL).times(100)
      : new Decimal(0);
    const pnlDisplay = round2(dailyPnlPct);
    const pnlStr = pnlDisplay >= 0 ? `+${pnlDisplay.toFixed(2)}` : pnlDisplay.toFixed(2);

    const delta = accuracyResult.stats.learning_delta;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);

    const insightOfTheDay =
      reports.length > 0
        ? (reports[0]!.key_lesson_he || reports[0]!.success_summary_he || 'אין תובנה חדשה היום.')
        : 'אין עדיין דוחות למידה.';

    const sentinelLabel = marketRisk.status === 'SAFE' ? 'בטוח' : 'מסוכן';
    const sentinelEmoji = marketRisk.status === 'SAFE' ? '🛡️' : '⚠️';

    const lines: string[] = [
      `${RTL_MARK}📅 <b>סיכום יומי — Smart Money v1.4</b>`,
      '',
      `📈 PnL יומי: ${pnlStr}%`,
      `🧠 שיפור בדיוק למידה: ${deltaStr}%`,
      `💡 תובנה יומית: ${insightOfTheDay}`,
      `${sentinelEmoji} מצב Sentinel: ${sentinelLabel}`,
      '',
      `— ${formatDateHe(now)}`,
    ];

    const text = lines.join('\n');
    const result = await sendTelegramMessage(text, {
      parse_mode: 'HTML',
      reply_markup: getDashboardReportKeyboard(getBaseUrl()),
    });

    if (result.ok) return { ok: true };
    return { ok: false, error: result.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
