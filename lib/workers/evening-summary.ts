/**
 * Evening Summary: deep learning and conclusion drawing from the day's data (22:00).
 * Aggregates scanner alerts and AI learning ledger for the day, then runs learning
 * from backtests to produce strategy insights.
 */

import { countScannerAlertsSince, listRecentAlertedSymbolsSince } from '@/lib/db/scanner-alert-log';
import { getRecentLedger } from '@/lib/db/ai-learning-ledger';
import { runLearningFromBacktests } from '@/lib/agents/learning-agent';
import { listHistoricalPredictions, type HistoricalPredictionRow } from '@/lib/db/historical-predictions';
import { round2 } from '@/lib/decimal';
import { getDashboardReportKeyboard, sendTelegramMessage } from '@/lib/telegram';
import { getBaseUrl } from '@/lib/config';
import { formatBoardMeetingForTelegram, runBoardOfExperts } from '@/lib/workers/board-of-experts';

const LAST_24H_MS = 24 * 60 * 60 * 1000;

export interface EveningSummaryResult {
  ok: boolean;
  error?: string;
  /** Scanner alerts count in the last 24h */
  alertsLast24h?: number;
  /** Ledger rows considered (recent) */
  ledgerRows?: number;
  /** Strategy insights created by learning agent */
  insightsCreated?: number;
  /** Closed-loop checks count in the period */
  closedLoopSamples?: number;
  /** Prediction accuracy score (0-100) for closed-loop checks */
  closedLoopAccuracyScore?: number;
  fearGreedValue?: number | null;
  fearGreedClassification?: string;
  rssHeadlinesUsed?: number;
  overseerVerdict?: string;
}

function computeClosedLoopAccuracy(rows: HistoricalPredictionRow[]): {
  samples: number;
  accuracyScore: number;
} {
  if (rows.length === 0) return { samples: 0, accuracyScore: 0 };
  let hits = 0;
  for (const row of rows) {
    const deltaPct = row.price_diff_pct;
    const dir = row.predicted_direction;
    if (dir === 'Bullish' && deltaPct > 0.2) hits += 1;
    else if (dir === 'Bearish' && deltaPct < -0.2) hits += 1;
    else if (dir === 'Neutral' && Math.abs(deltaPct) <= 0.75) hits += 1;
  }
  return {
    samples: rows.length,
    accuracyScore: round2((hits / rows.length) * 100),
  };
}

/**
 * Aggregates all data collected during the day and runs conclusion drawing
 * (learning from backtests → strategy insights). Safe to run daily at 22:00.
 */
export async function runEveningSummary(): Promise<EveningSummaryResult> {
  try {
    const [alertsLast24h, recentSymbols, ledgerRows, historicalRows, board] = await Promise.all([
      countScannerAlertsSince(LAST_24H_MS),
      listRecentAlertedSymbolsSince({ sinceMs: LAST_24H_MS, limit: 20 }),
      getRecentLedger(300),
      listHistoricalPredictions(500),
      runBoardOfExperts('evening'),
    ]);

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const ledgerToday = ledgerRows.filter((r) => new Date(r.timestamp) >= dayStart);
    const historicalToday = historicalRows.filter((r) => new Date(r.evaluated_at) >= dayStart);
    const closedLoop = computeClosedLoopAccuracy(historicalToday);

    const learning = await runLearningFromBacktests();

    const boardLines = formatBoardMeetingForTelegram('Board Meeting — Evening Summary', board);
    const lines: string[] = [
      '🌙 <b>Evening Summary — Smart Money</b>',
      '',
      `• Alerts last 24h: ${alertsLast24h}`,
      `• Ledger rows (recent): ${ledgerRows.length}`,
      `• Closed-loop samples: ${closedLoop.samples}`,
      `• Closed-loop accuracy: ${closedLoop.accuracyScore}%`,
      '',
      ...boardLines,
    ];
    await sendTelegramMessage(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: getDashboardReportKeyboard(getBaseUrl()),
    });

    return {
      ok: true,
      alertsLast24h,
      ledgerRows: ledgerRows.length,
      insightsCreated: learning.created,
      closedLoopSamples: closedLoop.samples,
      closedLoopAccuracyScore: closedLoop.accuracyScore,
      fearGreedValue: board.fearGreed.value,
      fearGreedClassification: board.fearGreed.valueClassification,
      rssHeadlinesUsed: board.topHeadlines.length,
      overseerVerdict: board.overseer.finalVerdict,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Evening Summary]', message);
    return { ok: false, error: message };
  }
}
