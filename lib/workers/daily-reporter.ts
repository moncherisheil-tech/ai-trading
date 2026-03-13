/**
 * Executive Morning Report: daily Telegram summary for הנהלה.
 * Cron-triggered (e.g. 08:00). Professional Hebrew, RTL. No personal names.
 */

import { getMacroPulse } from '@/lib/macro-service';
import { sendTelegramMessage } from '@/lib/telegram';
import { countScannerAlertsSince } from '@/lib/db/scanner-alert-log';

const LAST_24H_MS = 24 * 60 * 60 * 1000;

function formatDateHe(date: Date): string {
  return date.toLocaleDateString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Sends the Executive Morning Report to the configured Telegram chat.
 * Title: דוח בוקר להנהלה - [DATE]
 * Content: market state (F&G + BTC dominance), active strategy, opportunities (gems in last 24h).
 */
export async function runMorningReport(): Promise<{ ok: boolean; error?: string }> {
  try {
    const macro = await getMacroPulse();
    const gemsLast24h = countScannerAlertsSince(LAST_24H_MS);
    const dateHe = formatDateHe(new Date());

    const lines: string[] = [
      `📋 <b>דוח בוקר להנהלה — ${dateHe}</b>`,
      '',
      '<b>מצב שוק:</b>',
      `• מדד פחד ותאוות: ${macro.fearGreedIndex} (${macro.fearGreedClassification})`,
      `• דומיננטיות ביטקוין: ${macro.btcDominancePct}%`,
      `• ציון מאקרו מאוחד: ${macro.macroSentimentScore}`,
      '',
      `<b>אסטרטגיה פעילה:</b> ${macro.strategyLabelHe}`,
      '',
      `<b>הזדמנויות:</b> זוהו ${gemsLast24h} ג'מים פוטנציאליים ב-24 השעות האחרונות.`,
      '',
      '— אלגוריתם ה-AI, הנהלת המערכת',
    ];

    const text = lines.join('\n');
    const result = await sendTelegramMessage(text, { parse_mode: 'HTML' });

    if (result.ok) return { ok: true };
    return { ok: false, error: result.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
