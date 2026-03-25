/**
 * Executive Morning Report: daily Telegram summary for הנהלה.
 * Cron-triggered (e.g. 08:00). Professional Hebrew, RTL. No personal names.
 * Includes Market Safety Sentinel: Safe/Dangerous + reasoning.
 */

import { getMacroPulse } from '@/lib/macro-service';
import { getMarketRiskSentiment } from '@/lib/market-sentinel';
import { sendTelegramMessage, getDashboardReportKeyboard } from '@/lib/telegram';
import { countScannerAlertsSince, listRecentAlertedSymbolsSince } from '@/lib/db/scanner-alert-log';
import { generateBacktestSummary, runMiniBacktest } from '@/lib/ops/backtest-engine';
import { getBaseUrl } from '@/lib/config';
import { runBoardOfExperts } from '@/lib/workers/board-of-experts';

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
 * Content: market state (F&G + BTC dominance), Market Safety Status (Safe/Dangerous), active strategy, opportunities.
 */
export async function runMorningReport(): Promise<{ ok: boolean; error?: string }> {
  try {
    const [macro, marketRisk, gemsLast24h, recentGemSymbols, board] = await Promise.all([
      getMacroPulse(),
      getMarketRiskSentiment(),
      countScannerAlertsSince(LAST_24H_MS),
      listRecentAlertedSymbolsSince({ sinceMs: LAST_24H_MS, limit: 3 }),
      runBoardOfExperts('morning'),
    ]);
    const dateHe = formatDateHe(new Date());
    const safetyLabel = marketRisk.status === 'SAFE' ? 'Safe' : 'Dangerous';
    const safetyHe = marketRisk.status === 'SAFE' ? 'בטוח' : 'מסוכן';

    let miniBacktestSummary: string | null = null;
    if (recentGemSymbols.length > 0) {
      try {
        const reports = [];
        for (const symbol of recentGemSymbols) {
          // Bounded mini-backtest: enough history for EMA200, but only analyze last 10 candles to keep cron fast.
          reports.push(await runMiniBacktest({ symbol, historyDays: 70, analyzeLastCandles: 10 }));
        }
        miniBacktestSummary = generateBacktestSummary(reports);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Morning Report] Mini-backtest failed, skipping:', msg);
      }
    }

    const lines: string[] = [
      `📋 <b>דוח בוקר להנהלה — ${dateHe}</b>`,
      '',
      '<b>סטטוס שוק יומי:</b>',
      `• ${safetyLabel} (${safetyHe}) — ניתוח: ${marketRisk.reasoning}`,
      '',
      '<b>מצב שוק:</b>',
      `• מדד פחד ותאוות (לייב): ${board.fearGreed.value ?? 'Data Unavailable'} (${board.fearGreed.valueClassification})`,
      `• דומיננטיות ביטקוין: ${macro.btcDominancePct}%`,
      `• ציון מאקרו מאוחד: ${macro.macroSentimentScore}`,
      '',
      `<b>אסטרטגיה פעילה:</b> ${macro.strategyLabelHe}`,
      '',
      `<b>הזדמנויות:</b> זוהו ${gemsLast24h} ג'מים פוטנציאליים ב-24 השעות האחרונות.`,
      '',
      '<b>Board Meeting — 6 מומחים:</b>',
      ...(Object.values(board.experts) as Array<{ expert: string; stance: string; confidence: number }>).map(
        (expert) => `• ${expert.expert}: ${expert.stance.toUpperCase()} (${expert.confidence.toFixed(0)}/100)`
      ),
      '',
      `<b>Overseer:</b> ${board.overseer.finalVerdict.toUpperCase()} — ${board.overseer.actionPlan}`,
      ...(miniBacktestSummary
        ? [
            '',
            '<b>🧪 Mini-Backtest על ג\'מים (08:00):</b>',
            miniBacktestSummary,
          ]
        : []),
      '',
      '— אלגוריתם ה-AI, הנהלת המערכת',
    ];

    const text = lines.join('\n');
    const result = await sendTelegramMessage(text, {
      parse_mode: 'HTML',
      reply_markup: getDashboardReportKeyboard(getBaseUrl()),
    });

    if (result.ok) {
      console.log('[Morning Report] Telegram message sent successfully.');
      return { ok: true };
    }
    console.error('[Morning Report] Telegram send failed:', result.error);
    return { ok: false, error: result.error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Telegram Error:', err);
    return { ok: false, error: message };
  }
}
