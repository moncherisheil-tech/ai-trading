import { NextResponse } from 'next/server';
import { listHistoricalPredictions } from '@/lib/db/historical-predictions';
import type { HistoricalPredictionRow } from '@/lib/db/historical-predictions';
import { APP_CONFIG } from '@/lib/config';

const HIT_LABELS = ['bullish_win', 'bearish_win', 'neutral_win'];

function isHit(row: HistoricalPredictionRow): boolean {
  return HIT_LABELS.includes(row.outcome_label);
}

/** Signed return if user followed the signal: Bullish => price_diff_pct, Bearish => -price_diff_pct, Neutral => 0. */
function theoreticalReturnPct(row: HistoricalPredictionRow): number {
  if (row.predicted_direction === 'Bullish') return row.price_diff_pct;
  if (row.predicted_direction === 'Bearish') return -row.price_diff_pct;
  return 0;
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface BacktestAnalyticsResponse {
  successRatePct: number;
  mae: number;
  theoreticalRoiPct: number;
  totalPredictions: number;
  last24hAccuracyPct: number;
  last24hCount: number;
  topPerformingAsset: string;
  topPerformingAssetHitRate: number;
  outcomes: Array<{
    id: number;
    symbol: string;
    evaluated_at: string;
    predicted_direction: string;
    target_percentage: number | null;
    price_diff_pct: number;
    outcome_label: string;
    isHit: boolean;
  }>;
  accuracyByDay: Array<{ date: string; hits: number; total: number; accuracyPct: number }>;
  hebrewSummary: {
    summary: string;
    insight: string;
    recommendation: string;
  };
}

export async function GET(): Promise<NextResponse<BacktestAnalyticsResponse | { error: string }>> {
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    return NextResponse.json({
      successRatePct: 0,
      mae: 0,
      theoreticalRoiPct: 0,
      totalPredictions: 0,
      last24hAccuracyPct: 0,
      last24hCount: 0,
      topPerformingAsset: '—',
      topPerformingAssetHitRate: 0,
      outcomes: [],
      accuracyByDay: [],
      hebrewSummary: {
        summary: 'אין נתוני SQLite. הגדר DB_DRIVER=sqlite כדי לאפשר דשבורד בקטסט.',
        insight: 'הפעל הערכת תחזיות כדי למלא את טבלת historical_predictions.',
        recommendation: 'לאחר הגדרת SQLite והרצת הערכות, רענן דף זה.',
      },
    });
  }

  const rows = listHistoricalPredictions(500);
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const last24h = rows.filter((r) => now - new Date(r.evaluated_at).getTime() <= oneDayMs);

  const total = rows.length;
  const hits = rows.filter(isHit).length;
  const successRatePct = total > 0 ? (hits / total) * 100 : 0;

  const withTarget = rows.filter((r) => r.target_percentage != null);
  const mae =
    withTarget.length > 0
      ? withTarget.reduce((acc, r) => acc + Math.abs((r.target_percentage ?? 0) - r.price_diff_pct), 0) / withTarget.length
      : 0;

  const theoreticalRoiPct = rows.reduce((acc, r) => acc + theoreticalReturnPct(r), 0);

  const last24hHits = last24h.filter(isHit).length;
  const last24hCount = last24h.length;
  const last24hAccuracyPct = last24hCount > 0 ? (last24hHits / last24hCount) * 100 : 0;

  const bySymbol = rows.reduce<Record<string, { hits: number; total: number }>>((acc, r) => {
    if (!acc[r.symbol]) acc[r.symbol] = { hits: 0, total: 0 };
    acc[r.symbol].total++;
    if (isHit(r)) acc[r.symbol].hits++;
    return acc;
  }, {});
  let topPerformingAsset = '—';
  let topPerformingAssetHitRate = 0;
  for (const [symbol, data] of Object.entries(bySymbol)) {
    if (data.total < 2) continue;
    const rate = (data.hits / data.total) * 100;
    if (rate > topPerformingAssetHitRate) {
      topPerformingAssetHitRate = rate;
      topPerformingAsset = symbol.replace('USDT', '');
    }
  }

  const sevenDaysAgo = now - 7 * oneDayMs;
  const last7 = rows.filter((r) => new Date(r.evaluated_at).getTime() >= sevenDaysAgo);
  const byDate: Record<string, { hits: number; total: number }> = {};
  for (let d = 0; d < 7; d++) {
    const dayStart = new Date(now - d * oneDayMs);
    const dateKey = dayStart.toISOString().slice(0, 10);
    byDate[dateKey] = { hits: 0, total: 0 };
  }
  for (const r of last7) {
    const dateKey = new Date(r.evaluated_at).toISOString().slice(0, 10);
    if (!byDate[dateKey]) byDate[dateKey] = { hits: 0, total: 0 };
    byDate[dateKey].total++;
    if (isHit(r)) byDate[dateKey].hits++;
  }
  const accuracyByDay = Object.entries(byDate)
    .map(([date, { hits: h, total: t }]) => ({
      date,
      hits: h,
      total: t,
      accuracyPct: t > 0 ? (h / t) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const outcomes = rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    evaluated_at: r.evaluated_at,
    predicted_direction: r.predicted_direction,
    target_percentage: r.target_percentage ?? null,
    price_diff_pct: r.price_diff_pct,
    outcome_label: r.outcome_label,
    isHit: isHit(r),
  }));

  const summaryPct = Math.round(last24hCount > 0 ? last24hAccuracyPct : successRatePct);
  const hebrewSummary = {
    summary: `סיכום ביצועים: הבוט דייק ב-${summaryPct}% מהתחזיות${last24hCount > 0 ? ' ב-24 השעות האחרונות' : ''}. סה"כ ${total} תחזיות נותחו.`,
    insight:
      topPerformingAsset !== '—'
        ? `תובנה: המערכת מציגה דיוק מקסימלי במטבעות בעלי נזילות גבוהה (במקום הראשון: ${topPerformingAsset} עם ${Math.round(topPerformingAssetHitRate)}% דיוק).`
        : total > 0
          ? 'תובנה: המשך איסוף נתונים יאפשר זיהוי מטבעות עם ביצועים מיטביים.'
          : 'תובנה: הרץ הערכת תחזיות כדי להתחיל לאסוף נתוני דיוק.',
    recommendation:
      successRatePct >= 80
        ? 'המלצה: ניתן לשקול מעבר למסחר אוטומטי (Action Agent) עבור סיגנלים מעל 80% הסתברות.'
        : successRatePct >= 60
          ? 'המלצה: שפר את הדיוק עם סינון ג\'מס (נזילות ונפח) לפני הפעלת סוכן אוטומטי.'
          : 'המלצה: המשך ניתוח ידני והערכת תחזיות כדי לשפר את מודל הדיוק.',
  };

  return NextResponse.json({
    successRatePct,
    mae,
    theoreticalRoiPct,
    totalPredictions: total,
    last24hAccuracyPct,
    last24hCount,
    topPerformingAsset,
    topPerformingAssetHitRate,
    outcomes,
    accuracyByDay,
    hebrewSummary,
  });
}
