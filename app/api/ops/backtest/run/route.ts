import { NextRequest, NextResponse } from 'next/server';
import { getAppSettings, setAppSettings } from '@/lib/db/app-settings';
import { generateBacktestSummary, performanceTierFromAccuracy, runBacktest, type BacktestReport } from '@/lib/ops/backtest-engine';

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
  const timerName = `backtest-get-${Math.random().toString(36).slice(2, 7)}`;
  console.time(timerName);
  
  try {
    // שימוש ב-nextUrl המובנה של Next.js 15 ליציבות מקסימלית
    const { searchParams } = req.nextUrl;
    
    // שליפה בטוחה של הסוד
    const rawSecret = searchParams.get('secret');
    const incomingSecret = typeof rawSecret === 'string' ? rawSecret.trim() : "";
    
    const rawEnvSecret = process.env.WORKER_CRON_SECRET;
    const envSecret = typeof rawEnvSecret === 'string' ? rawEnvSecret.trim() : "";

    // בדיקת הרשאה
    if (!incomingSecret || incomingSecret !== envSecret) {
      console.warn('[Backtest] Unauthorized attempt or secret mismatch');
      console.timeEnd(timerName);
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

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

  } catch (error: any) {
    console.error('[Backtest GET Critical Error]:', error);
    try { console.timeEnd(timerName); } catch (e) { console.warn('[Backtest GET] timer cleanup failed:', e); }
    return NextResponse.json({ ok: false, error: error.message || 'Unknown Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const timerName = `backtest-post-${Math.random().toString(36).slice(2, 7)}`;
  console.time(timerName);

  try {
    const { searchParams } = req.nextUrl;
    const body = await req.json().catch(() => ({}));

    const rawSecret = searchParams.get('secret');
    const incomingSecret = typeof rawSecret === 'string' ? rawSecret.trim() : "";
    
    const rawEnvSecret = process.env.WORKER_CRON_SECRET;
    const envSecret = typeof rawEnvSecret === 'string' ? rawEnvSecret.trim() : "";

    if (!incomingSecret || incomingSecret !== envSecret) {
      console.timeEnd(timerName);
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    let symbols: string[] = [];
    if (Array.isArray(body.symbols)) {
      symbols = body.symbols
        .map((s: any) => (s ? String(s).trim().toUpperCase() : ""))
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

  } catch (error: any) {
    console.error('[Backtest POST Critical Error]:', error);
    try { console.timeEnd(timerName); } catch (e) { console.warn('[Backtest POST] timer cleanup failed:', e); }
    return NextResponse.json({ ok: false, error: error.message || 'Unknown Error' }, { status: 500 });
  }
}
