/**
 * Adaptive Reporting & Learning Monitor (v1.4).
 * daily_accuracy_stats: daily win rate, prediction accuracy vs actual PnL, learning delta.
 * Compares agent_insights (outcome/insight) with virtual_portfolio (pnl_pct) to measure intelligence growth.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';
import { toDecimal, round2 } from '@/lib/decimal';
import { listAgentInsightsInRange } from '@/lib/db/agent-insights';
import { listClosedVirtualTradesInRange } from '@/lib/db/virtual-portfolio';

export interface DailyAccuracyStatsRow {
  stat_date: string;
  win_rate: number;
  prediction_accuracy_score: number;
  learning_delta: number;
  false_positives_avoided: number;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

async function ensureTable(): Promise<boolean> {
  if (!usePostgres()) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS daily_accuracy_stats (
        stat_date DATE PRIMARY KEY,
        win_rate NUMERIC(10,4) NOT NULL DEFAULT 0,
        prediction_accuracy_score NUMERIC(10,4) NOT NULL DEFAULT 0,
        learning_delta NUMERIC(10,4) NOT NULL DEFAULT 0,
        false_positives_avoided INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_daily_accuracy_stats_stat_date ON daily_accuracy_stats(stat_date DESC)`;
    return true;
  } catch (err) {
    console.error('daily_accuracy_stats ensureTable failed:', err);
    return false;
  }
}

/** Infer from insight/outcome text whether the agent considered the trade a success or failure. */
function insightIndicatesSuccess(insight: string | null, outcome: string | null): boolean {
  const text = `${insight ?? ''} ${outcome ?? ''}`;
  if (/הצליחה|רווח|take_profit|הגעה ליעד/i.test(text)) return true;
  if (/נכשלה|סטופ|ניקוי|כשלון|stop_loss|liquidation/i.test(text)) return false;
  return true;
}

/**
 * Calculate daily accuracy: match agent_insights (by trade_id) to virtual_portfolio closed that day.
 * Win rate = % of closed trades with pnl_pct > 0.
 * Prediction accuracy = % where agent's outcome/insight agrees with actual pnl (success vs success, failure vs failure).
 * Learning delta = today's prediction_accuracy_score minus yesterday's (improvement).
 * false_positives_avoided: reserved for Neural Fortress filter count (e.g. signals skipped due to low confidence); 0 when not tracked.
 */
export async function calculateDailyAccuracyDelta(
  forDate?: string
): Promise<{ stats: DailyAccuracyStatsRow; recorded: boolean }> {
  const dateStr = forDate ?? new Date().toISOString().slice(0, 10);
  const dayStart = `${dateStr}T00:00:00.000Z`;
  const dayEnd = `${dateStr}T23:59:59.999Z`;

  const defaultStats: DailyAccuracyStatsRow = {
    stat_date: dateStr,
    win_rate: 0,
    prediction_accuracy_score: 0,
    learning_delta: 0,
    false_positives_avoided: 0,
  };

  if (!usePostgres()) return { stats: defaultStats, recorded: false };

  try {
    const ok = await ensureTable();
    if (!ok) return { stats: defaultStats, recorded: false };

    const [insightsInRange, closedInRange] = await Promise.all([
      listAgentInsightsInRange(dayStart, dayEnd),
      listClosedVirtualTradesInRange(dayStart, dayEnd),
    ]);

    const tradeIdsClosedToday = new Set(closedInRange.map((t) => t.id));
    const tradeById = new Map(closedInRange.map((t) => [t.id, t]));

    const matched: { insightSuccess: boolean; actualWin: boolean }[] = [];
    for (const ins of insightsInRange) {
      const trade = tradeById.get(ins.trade_id) ?? null;
      if (!trade || !tradeIdsClosedToday.has(ins.trade_id)) continue;
      const pnl = trade.pnl_pct ?? 0;
      const actualWin = pnl > 0;
      const insightSuccess = insightIndicatesSuccess(ins.insight, ins.outcome);
      matched.push({ insightSuccess, actualWin });
    }

    const wins = closedInRange.filter((t) => (t.pnl_pct ?? 0) > 0).length;
    const totalClosed = closedInRange.length;
    const winRate = totalClosed > 0 ? toDecimal(wins).div(totalClosed).times(100).toNumber() : 0;

    const correctPredictions = matched.filter(
      (m) => (m.insightSuccess && m.actualWin) || (!m.insightSuccess && !m.actualWin)
    ).length;
    const totalMatched = matched.length;
    const predictionAccuracyScore =
      totalMatched > 0 ? toDecimal(correctPredictions).div(totalMatched).times(100).toNumber() : 0;

    let learningDelta = 0;
    const yesterday = new Date(dateStr);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const yesterdayRow = await getDailyAccuracyStatsByDate(yesterdayStr);
    if (yesterdayRow) {
      learningDelta = round2(toDecimal(predictionAccuracyScore).minus(yesterdayRow.prediction_accuracy_score));
    }

    const falsePositivesAvoided = 0;

    const stats: DailyAccuracyStatsRow = {
      stat_date: dateStr,
      win_rate: round2(winRate),
      prediction_accuracy_score: round2(predictionAccuracyScore),
      learning_delta: round2(learningDelta),
      false_positives_avoided: falsePositivesAvoided,
    };

    await sql`
      INSERT INTO daily_accuracy_stats (stat_date, win_rate, prediction_accuracy_score, learning_delta, false_positives_avoided)
      VALUES (${dateStr}, ${stats.win_rate}, ${stats.prediction_accuracy_score}, ${stats.learning_delta}, ${stats.false_positives_avoided})
      ON CONFLICT (stat_date) DO UPDATE SET
        win_rate = EXCLUDED.win_rate,
        prediction_accuracy_score = EXCLUDED.prediction_accuracy_score,
        learning_delta = EXCLUDED.learning_delta,
        false_positives_avoided = EXCLUDED.false_positives_avoided
    `;

    return { stats, recorded: true };
  } catch (err) {
    console.error('calculateDailyAccuracyDelta failed:', err);
    return { stats: defaultStats, recorded: false };
  }
}

export async function getDailyAccuracyStatsByDate(statDate: string): Promise<DailyAccuracyStatsRow | null> {
  if (!usePostgres()) return null;
  try {
    const ok = await ensureTable();
    if (!ok) return null;
    const { rows } = await sql`
      SELECT stat_date::text, win_rate::float, prediction_accuracy_score::float, learning_delta::float, false_positives_avoided::int
      FROM daily_accuracy_stats WHERE stat_date = ${statDate}
    `;
    const r = rows?.[0] as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      stat_date: String(r.stat_date),
      win_rate: Number(r.win_rate),
      prediction_accuracy_score: Number(r.prediction_accuracy_score),
      learning_delta: Number(r.learning_delta),
      false_positives_avoided: Number(r.false_positives_avoided ?? 0),
    };
  } catch (err) {
    console.error('getDailyAccuracyStatsByDate failed:', err);
    return null;
  }
}

export async function getDailyAccuracyStatsInRange(
  fromDate: string,
  toDate: string
): Promise<DailyAccuracyStatsRow[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const { rows } = await sql`
      SELECT stat_date::text, win_rate::float, prediction_accuracy_score::float, learning_delta::float, false_positives_avoided::int
      FROM daily_accuracy_stats
      WHERE stat_date >= ${fromDate} AND stat_date <= ${toDate}
      ORDER BY stat_date ASC
    `;
    return (rows || []).map((r: Record<string, unknown>) => ({
      stat_date: String(r.stat_date),
      win_rate: Number(r.win_rate),
      prediction_accuracy_score: Number(r.prediction_accuracy_score),
      learning_delta: Number(r.learning_delta),
      false_positives_avoided: Number(r.false_positives_avoided ?? 0),
    })) as DailyAccuracyStatsRow[];
  } catch (err) {
    console.error('getDailyAccuracyStatsInRange failed:', err);
    return [];
  }
}
