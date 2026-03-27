import { NextRequest, NextResponse } from 'next/server';
import { getAppSettings, setAppSettings } from '@/lib/db/app-settings';
import { generateBacktestSummary, performanceTierFromAccuracy, runBacktest, type BacktestReport } from '@/lib/ops/backtest-engine';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';
import { generateSafeId } from '@/lib/utils';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown Error';
}

/**
 * Persist bestExpertKey per symbol to Deep Memory (app_settings.neural.bestExpertBySymbol) so runConsensusEngine can boost that expert's weight.
 */
async function persistBestExpertFromReports(reports: BacktestReport[]): Promise<void> {
  try {
    const settings = await getAppSettings();
    const existing = settings.neural?.bestExpertBySymbol ?? {};
    let updated = false;
    const next: Record<string, { bestExpertKey: string; accuracyPct: number }> = { ...existing };
    for (const r of reports) {
      const key = r.expertPerformance.bestExpertKey;
      if (!key || key === 'bestExpertKey') continue;
      const stats = r.expertPerformance[key];
      if (stats && typeof stats.accuracyPct === 'number') {
        const symbol = (r.symbol || '').trim().toUpperCase();
        if (!symbol) continue;
        next[symbol] = { bestExpertKey: key, accuracyPct: stats.accuracyPct };
        updated = true;
      }
    }
    if (updated) {
      await setAppSettings({ neural: { ...settings.neural, bestExpertBySymbol: next } });
    }
  } catch (e) {
    console.warn('[Backtest] Failed to persist bestExpertBySymbol to Deep Memory:', e);
  }
}

/**
 * מנוע הרצת Backtest גרסה 3.0 - מוגנת קריסות (Mon Cheri Quant)
 */

export async function GET(req: NextRequest) {
  const timerName = `backtest-get-${generateSafeId()}`;
  console.time(timerName);
  
  try {
    if (!validateAdminOrCronAuth(req)) {
      console.timeEnd(timerName);
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;

    // ניתוח סימבולים בטוח
    const symbolsParam = searchParams.get('symbols');
    let symbols: string[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]; // ברירת מחדל
    
    if (symbolsParam && typeof symbolsParam === 'string') {
      symbols = symbolsParam
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }

    // טווחי תאריכים בטוחים עם ברירות מחדל
    const DEFAULT_START = '2025-11-01T00:00:00Z';
    const DEFAULT_END = '2025-12-30T00:00:00Z';

    const rawStart = searchParams.get('startDate');
    const rawEnd = searchParams.get('endDate');

    const startDateStr = rawStart && rawStart.trim() ? rawStart.trim() : DEFAULT_START;
    const endDateStr = rawEnd && rawEnd.trim() ? rawEnd.trim() : DEFAULT_END;

    const startDateMs = Math.floor(new Date(startDateStr).getTime());
    const endDateMs = Math.floor(new Date(endDateStr).getTime());

    // הרצה לכל סימבול בנפרד
    const reports = await Promise.all(
      symbols.map((symbol) =>
        runBacktest({
          symbol,
          startDate: startDateMs,
          endDate: endDateMs,
        })
      )
    );

    const insightsSummary = generateBacktestSummary(reports);
    const reportsWithTier = reports.map((r) => ({
      ...r,
      performanceTier: performanceTierFromAccuracy(r.accuracyPct),
    }));

    // חישוב ביצועים גלובליים
    const aggregate = reports.reduce(
      (acc, report) => {
        acc.totalWins += report.wins;
        acc.totalLosses += report.losses;
        acc.totalPredictions += report.totalPredictions;
        acc.accuracySum += report.accuracyPct;
        return acc;
      },
      { totalWins: 0, totalLosses: 0, totalPredictions: 0, accuracySum: 0 }
    );

    const coinsCount = reports.length || 1;
    const averageAccuracyPct = aggregate.accuracySum / coinsCount || 0;

    const summary = {
      totalWins: aggregate.totalWins,
      totalLosses: aggregate.totalLosses,
      totalPredictions: aggregate.totalPredictions,
      averageAccuracyPct,
      symbols,
    };

    await persistBestExpertFromReports(reports);

    console.timeEnd(timerName);
    return NextResponse.json({
      ok: true,
      source: 'GET',
      insightsSummary,
      summary,
      details: reportsWithTier,
    });

  } catch (error: unknown) {
    console.error('[Backtest GET Critical Error]:', error);
    try { console.timeEnd(timerName); } catch (e) { console.warn('[Backtest GET] timer cleanup failed:', e); }
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const timerName = `backtest-post-${generateSafeId()}`;
  console.time(timerName);

  try {
    if (!validateAdminOrCronAuth(req)) {
      console.timeEnd(timerName);
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    let symbols: string[] = [];
    if (Array.isArray(body.symbols)) {
      symbols = body.symbols
        .map((s: unknown) => (s ? String(s).trim().toUpperCase() : ""))
        .filter(Boolean);
    } else {
      const singleSymbol = body.symbol || 'BTCUSDT';
      symbols = [String(singleSymbol).trim().toUpperCase()];
    }

    // הרצה לכל סימבול בנפרד
    const reports = await Promise.all(
      symbols.map((symbol) =>
        runBacktest({
          symbol,
          startDate: body.startDate,
          endDate: body.endDate,
        })
      )
    );

    const insightsSummary = generateBacktestSummary(reports);
    const reportsWithTier = reports.map((r) => ({
      ...r,
      performanceTier: performanceTierFromAccuracy(r.accuracyPct),
    }));

    // חישוב ביצועים גלובליים
    const aggregate = reports.reduce(
      (acc, report) => {
        acc.totalWins += report.wins;
        acc.totalLosses += report.losses;
        acc.totalPredictions += report.totalPredictions;
        acc.accuracySum += report.accuracyPct;
        return acc;
      },
      { totalWins: 0, totalLosses: 0, totalPredictions: 0, accuracySum: 0 }
    );

    const coinsCount = reports.length || 1;
    const averageAccuracyPct = aggregate.accuracySum / coinsCount || 0;

    const summary = {
      totalWins: aggregate.totalWins,
      totalLosses: aggregate.totalLosses,
      totalPredictions: aggregate.totalPredictions,
      averageAccuracyPct,
      symbols,
    };

    await persistBestExpertFromReports(reports);

    console.timeEnd(timerName);
    return NextResponse.json({
      ok: true,
      source: 'POST',
      insightsSummary,
      summary,
      details: reportsWithTier,
    });

  } catch (error: unknown) {
    console.error('[Backtest POST Critical Error]:', error);
    try { console.timeEnd(timerName); } catch (e) { console.warn('[Backtest POST] timer cleanup failed:', e); }
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
