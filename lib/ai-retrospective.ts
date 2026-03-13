/**
 * AI Retrospective Engine — Self-Learning Loop.
 * Scans virtual_portfolio and historical_predictions, identifies failure patterns,
 * calibrates formula weights, and generates daily "Lessons Learned" reports in Hebrew.
 * Privacy: no personal names; use generic terms (הנהלה, המערכת, האלגוריתם).
 */

import { listClosedVirtualTrades } from '@/lib/db/virtual-portfolio';
import { listHistoricalPredictions } from '@/lib/db/historical-predictions';
import {
  getWeights,
  setWeights,
  appendAccuracySnapshot,
  getAccuracySnapshots,
  DEFAULT_WEIGHTS,
  type PredictionWeights,
} from '@/lib/db/prediction-weights';
import { insertLearningReport, getLatestLearningReports } from '@/lib/db/learning-reports';
import { APP_CONFIG } from '@/lib/config';

const HIT_LABELS = ['bullish_win', 'bearish_win', 'neutral_win'];
const FAILURE_MIN_SAMPLE = 5;
const WEIGHT_ADJUSTMENT_STEP = 0.05;
const MIN_WEIGHT = 0.15;
const MAX_WEIGHT = 0.55;

function isHit(outcomeLabel: string): boolean {
  return HIT_LABELS.includes(outcomeLabel);
}

/** Classify virtual trade: 'take_profit' | 'stop_loss' | 'other' */
function classifyVirtualTrade(
  pnlPct: number | null,
  targetProfitPct: number,
  stopLossPct: number
): 'take_profit' | 'stop_loss' | 'other' {
  if (pnlPct == null) return 'other';
  if (pnlPct >= targetProfitPct) return 'take_profit';
  if (pnlPct <= stopLossPct) return 'stop_loss';
  return 'other';
}

export interface FailurePattern {
  type: 'stop_loss' | 'direction_miss';
  count: number;
  avgSentiment: number | null;
  avgAbsoluteError: number;
  highVolatilityShare: number;
}

export interface RetrospectiveResult {
  successRatePct: number;
  virtualTakeProfitCount: number;
  virtualStopLossCount: number;
  historicalHits: number;
  historicalMisses: number;
  failurePatterns: FailurePattern[];
  weightsUpdated: boolean;
  previousWeights: PredictionWeights;
  newWeights: PredictionWeights;
  reason: string | null;
}

/**
 * Scans virtual_portfolio and historical_predictions, identifies failure patterns
 * (Stop-Loss vs Take-Profit; direction_miss with sentiment/error correlation),
 * and runs weight optimization if RSI/sentiment was a poor predictor in recent failures.
 */
export function runRetrospectiveAnalysis(): RetrospectiveResult {
  const previousWeights = getWeights();
  let newWeights = { ...previousWeights };
  let weightsUpdated = false;
  let reason: string | null = null;

  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return {
      successRatePct: 0,
      virtualTakeProfitCount: 0,
      virtualStopLossCount: 0,
      historicalHits: 0,
      historicalMisses: 0,
      failurePatterns: [],
      weightsUpdated: false,
      previousWeights,
      newWeights: previousWeights,
      reason: null,
    };
  }

  const closedVirtual = listClosedVirtualTrades(100);
  let virtualTakeProfitCount = 0;
  let virtualStopLossCount = 0;
  for (const t of closedVirtual) {
    const kind = classifyVirtualTrade(t.pnl_pct ?? 0, t.target_profit_pct, t.stop_loss_pct);
    if (kind === 'take_profit') virtualTakeProfitCount++;
    else if (kind === 'stop_loss') virtualStopLossCount++;
  }

  const historical = listHistoricalPredictions(200);
  const hits = historical.filter((r) => isHit(r.outcome_label));
  const misses = historical.filter((r) => r.outcome_label === 'direction_miss' || r.outcome_label === 'invalid');
  const totalEval = hits.length + misses.length;
  const successRatePct = totalEval > 0 ? (hits.length / totalEval) * 100 : 0;

  appendAccuracySnapshot(successRatePct);

  const failurePatterns: FailurePattern[] = [];

  if (closedVirtual.length > 0) {
    const stopLossShare = virtualStopLossCount / closedVirtual.length;
    failurePatterns.push({
      type: 'stop_loss',
      count: virtualStopLossCount,
      avgSentiment: null,
      avgAbsoluteError: 0,
      highVolatilityShare: stopLossShare,
    });
  }

  if (misses.length > 0) {
    const avgAbsErr = misses.reduce((a, r) => a + r.absolute_error_pct, 0) / misses.length;
    const withSentiment = misses.filter((r) => r.sentiment_score != null);
    const avgSent = withSentiment.length > 0
      ? withSentiment.reduce((a, r) => a + (r.sentiment_score ?? 0), 0) / withSentiment.length
      : null;
    const highErrorShare = misses.filter((r) => r.absolute_error_pct > 3).length / misses.length;
    failurePatterns.push({
      type: 'direction_miss',
      count: misses.length,
      avgSentiment: avgSent,
      avgAbsoluteError: avgAbsErr,
      highVolatilityShare: highErrorShare,
    });
  }

  const last10Misses = misses.slice(0, 10);
  if (last10Misses.length >= 5 && last10Misses.some((r) => r.sentiment_score != null)) {
    const avgSentimentInFailures = last10Misses.reduce((a, r) => a + (r.sentiment_score ?? 0), 0) / last10Misses.filter((r) => r.sentiment_score != null).length;
    const avgAbsErrInFailures = last10Misses.reduce((a, r) => a + r.absolute_error_pct, 0) / last10Misses.length;
    if (avgAbsErrInFailures > 2.5 && successRatePct < 55) {
      const rsiWeight = previousWeights.rsi;
      const sentWeight = previousWeights.sentiment;
      const volWeight = previousWeights.volume;
      if (rsiWeight >= MIN_WEIGHT + WEIGHT_ADJUSTMENT_STEP) {
        newWeights = {
          volume: Math.min(MAX_WEIGHT, volWeight + WEIGHT_ADJUSTMENT_STEP / 2),
          rsi: Math.max(MIN_WEIGHT, rsiWeight - WEIGHT_ADJUSTMENT_STEP),
          sentiment: Math.min(MAX_WEIGHT, sentWeight + WEIGHT_ADJUSTMENT_STEP / 2),
        };
        const sum = newWeights.volume + newWeights.rsi + newWeights.sentiment;
        newWeights.volume = Math.round(newWeights.volume * 100) / 100;
        newWeights.rsi = Math.round(newWeights.rsi * 100) / 100;
        newWeights.sentiment = Math.round((1 - newWeights.volume - newWeights.rsi) * 100) / 100;
        reason = `משקל RSI הופחת מ-${(rsiWeight * 100).toFixed(0)}% ל-${(newWeights.rsi * 100).toFixed(0)}% בשל MAE גבוה ב-10 המסחרים האחרונים — עדכון אוטומטי.`;
        setWeights(newWeights, reason);
        weightsUpdated = true;
      } else if (Math.abs(avgSentimentInFailures) > 0.5 && sentWeight >= MIN_WEIGHT + WEIGHT_ADJUSTMENT_STEP) {
        newWeights = {
          volume: Math.min(MAX_WEIGHT, volWeight + WEIGHT_ADJUSTMENT_STEP / 2),
          rsi: Math.min(MAX_WEIGHT, rsiWeight + WEIGHT_ADJUSTMENT_STEP / 2),
          sentiment: Math.max(MIN_WEIGHT, sentWeight - WEIGHT_ADJUSTMENT_STEP),
        };
        newWeights.sentiment = Math.round((1 - newWeights.volume - newWeights.rsi) * 100) / 100;
        reason = `משקל הסנטימנט הופחת ל-${(newWeights.sentiment * 100).toFixed(0)}% לאחר כישלונות בתנאי קיצון — עדכון אוטומטי.`;
        setWeights(newWeights, reason);
        weightsUpdated = true;
      }
    }
  }

  return {
    successRatePct,
    virtualTakeProfitCount,
    virtualStopLossCount,
    historicalHits: hits.length,
    historicalMisses: misses.length,
    failurePatterns,
    weightsUpdated,
    previousWeights,
    newWeights,
    reason,
  };
}

export interface DailyInsights {
  successSummary: string;
  keyLesson: string;
  actionTaken: string;
  accuracyPct: number;
}

/**
 * Generates the daily "Lessons Learned" report in professional Hebrew.
 * Privacy: no personal names; use האלגוריתם, המערכת, הנהלה.
 */
export function generateDailyInsights(result: RetrospectiveResult): DailyInsights {
  const { successRatePct, virtualTakeProfitCount, virtualStopLossCount, historicalHits, historicalMisses, weightsUpdated, previousWeights, newWeights, reason } = result;
  const totalSim = virtualTakeProfitCount + virtualStopLossCount;
  const simRate = totalSim > 0 ? (virtualTakeProfitCount / totalSim) * 100 : successRatePct;

  const successSummary =
    totalSim > 0
      ? `האלגוריתם דייק ב-${simRate.toFixed(0)}% מהסימולציות האחרונות (${virtualTakeProfitCount} Take-Profit, ${virtualStopLossCount} Stop-Loss).`
      : historicalHits + historicalMisses > 0
        ? `האלגוריתם דייק ב-${successRatePct.toFixed(0)}% מהתחזיות שאומתו (${historicalHits} הצלחות, ${historicalMisses} כישלונות).`
        : 'אין עדיין מספיק נתונים לסיכום ביצועים.';

  let keyLesson = 'לא זוהו דפוסי כישלון חריגים.';
  if (result.failurePatterns.length > 0) {
    const stopLoss = result.failurePatterns.find((p) => p.type === 'stop_loss');
    const dirMiss = result.failurePatterns.find((p) => p.type === 'direction_miss');
    if (stopLoss && stopLoss.highVolatilityShare > 0.4) {
      keyLesson = 'זוהתה רגישות גבוהה לתנודתיות במטבעות מסוימים — מומלץ להדק סף Stop-Loss.';
    } else if (dirMiss && (dirMiss.avgAbsoluteError ?? 0) > 2.5) {
      keyLesson = 'זוהתה רגישות גבוהה לתנודתיות במטבעות מסוימים.';
    } else if (dirMiss && dirMiss.avgSentiment != null && Math.abs(dirMiss.avgSentiment) > 0.5) {
      keyLesson = 'כישלונות מתואמים עם סנטימנט קיצוני — המערכת תעדכן משקלים בהתאם.';
    }
  }

  const actionTaken = weightsUpdated && reason
    ? reason
    : weightsUpdated
      ? `משקל ה-RSI עודכן מ-${(previousWeights.rsi * 100).toFixed(0)}% ל-${(newWeights.rsi * 100).toFixed(0)}% לשיפור הדיוק.`
      : 'לא בוצעה עדכון משקלים — הדיוק הנוכחי בתוך הטווח המקובל.';

  return {
    successSummary,
    keyLesson,
    actionTaken,
    accuracyPct: successRatePct,
  };
}

/**
 * Full run: retrospective analysis + generate insights + persist report.
 * Returns insights for Telegram/UI. Call from cron or after N closed trades.
 */
export function runRetrospectiveAndReport(): { result: RetrospectiveResult; insights: DailyInsights; reportId: number } {
  const result = runRetrospectiveAnalysis();
  const insights = generateDailyInsights(result);
  let reportId = 0;
  if (APP_CONFIG.dbDriver === 'sqlite') {
    reportId = insertLearningReport({
      success_summary_he: insights.successSummary,
      key_lesson_he: insights.keyLesson,
      action_taken_he: insights.actionTaken,
      accuracy_pct: insights.accuracyPct,
    });
  }
  return { result, insights, reportId };
}

/**
 * Returns accuracy trend since engine activation (for Learning Progress dashboard).
 */
export function getLearningProgress(): { snapshots: Array<{ date: string; success_rate_pct: number }>; latestReport: DailyInsights | null } {
  const snapshots = getAccuracySnapshots(30).map((s) => ({ date: s.date, success_rate_pct: s.success_rate_pct }));
  const reports = getLatestLearningReports(1);
  const latest = reports[0];
  const latestReport: DailyInsights | null = latest
    ? {
        successSummary: latest.success_summary_he,
        keyLesson: latest.key_lesson_he,
        actionTaken: latest.action_taken_he,
        accuracyPct: latest.accuracy_pct,
      }
    : null;
  return { snapshots, latestReport };
}
