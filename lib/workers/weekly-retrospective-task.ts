/**
 * Weekly AI Retrospective (CEO Saturday Report) — v1.4.
 * Runs every Saturday at 21:00. Detailed analysis: top symbol, lessons learned, calibration recommendations.
 * Uses Decimal.js for PnL; RTL-friendly Telegram formatting.
 */

import Decimal from 'decimal.js';
import { listClosedVirtualTradesInRange } from '@/lib/db/virtual-portfolio';
import { getLearningReportsInRange } from '@/lib/db/learning-reports';
import { getWeights, getWeightChangeLog } from '@/lib/db/prediction-weights';
import { sendTelegramMessage, getDashboardReportKeyboard } from '@/lib/telegram';
import { toDecimal, round2 } from '@/lib/decimal';
import { getBaseUrl } from '@/lib/config';

const RTL_MARK = '\u200F';

function getWeekRange(): { weekStart: string; weekEnd: string } {
  const now = new Date();
  const day = now.getDay();
  const saturdayOffset = day === 6 ? 0 : day + 1;
  const lastSaturday = new Date(now);
  lastSaturday.setDate(now.getDate() - saturdayOffset);
  const weekStart = new Date(lastSaturday);
  weekStart.setDate(lastSaturday.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(lastSaturday);
  weekEnd.setHours(23, 59, 59, 999);
  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
  };
}

/**
 * Runs the Weekly Retrospective task: top symbol by PnL, lessons from learning_reports, calibration from weight_change_log + current weights.
 * Schedule: Saturday 21:00 (cron).
 */
export async function runWeeklyRetrospectiveTask(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { weekStart, weekEnd } = getWeekRange();
    const weekStartDate = weekStart.slice(0, 10);
    const weekEndDate = weekEnd.slice(0, 10);

    const [closedInWeek, reportsInWeek, weights, weightLog] = await Promise.all([
      listClosedVirtualTradesInRange(weekStart, weekEnd),
      getLearningReportsInRange(weekStart, weekEnd),
      getWeights(),
      getWeightChangeLog(10),
    ]);

    const symbolPnl = new Map<string, Decimal>();
    for (const t of closedInWeek) {
      if (t.pnl_pct == null) continue;
      const pnlUsd = toDecimal(t.amount_usd).times(t.pnl_pct).div(100);
      const cur = symbolPnl.get(t.symbol) ?? toDecimal(0);
      symbolPnl.set(t.symbol, cur.plus(pnlUsd));
    }

    let topSymbol = '—';
    let topPnlPct = 0;
    if (symbolPnl.size > 0) {
      const sorted = [...symbolPnl.entries()].sort((a, b) => b[1].comparedTo(a[1]));
      const [sym, pnlUsd] = sorted[0]!;
      topSymbol = sym;
      const totalExposure = closedInWeek
        .filter((t) => t.symbol === sym)
        .reduce((s, t) => s.plus(toDecimal(t.amount_usd)), toDecimal(0));
      topPnlPct = totalExposure.gt(0) ? pnlUsd.div(totalExposure).times(100).toNumber() : 0;
    }

    const lessonsSummary =
      reportsInWeek.length > 0
        ? reportsInWeek
            .map((r) => r.key_lesson_he || r.action_taken_he)
            .filter(Boolean)
            .slice(0, 5)
            .join('\n• ')
        : 'לא נרשמו לקחים השבוע.';

    const calibrationLines: string[] = [
      `משקלים נוכחיים: נפח ${(weights.volume * 100).toFixed(0)}% | RSI ${(weights.rsi * 100).toFixed(0)}% | סנטימנט ${(weights.sentiment * 100).toFixed(0)}%.`,
    ];
    const weekLog = weightLog.filter((l) => {
      const d = new Date(l.created_at).getTime();
      return d >= new Date(weekStart).getTime() && d <= new Date(weekEnd).getTime();
    });
    if (weekLog.length > 0) {
      calibrationLines.push('שינויים השבוע:');
      weekLog.slice(0, 3).forEach((l) => calibrationLines.push(`• ${l.reason_he}`));
    } else {
      calibrationLines.push('לא בוצעו שינויי כיול השבוע — המשקלים יציבים.');
    }
    const calibrationBlock = calibrationLines.join('\n');

    const lines: string[] = [
      `${RTL_MARK}🏆 <b>דוח CEO — רטרוספקטיבה שבועית Smart Money v1.4</b>`,
      '',
      '<b>מהלך השבוע:</b>',
      `סמל מוביל: ${topSymbol} — רווח/הפסד: ${topPnlPct >= 0 ? '+' : ''}${round2(topPnlPct).toFixed(2)}%`,
      '',
      '<b>לקחים שהופקו:</b>',
      `• ${lessonsSummary}`,
      '',
      '<b>המלצות כיול:</b>',
      calibrationBlock,
      '',
      `תקופה: ${weekStartDate} — ${weekEndDate}`,
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
