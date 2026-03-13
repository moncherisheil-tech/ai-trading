/**
 * Live Scanning Worker: scans market every 20 minutes, runs AI analysis on gems,
 * logs high-confidence predictions and sends Telegram alerts with simulation buttons.
 */

import { getCachedGemsTicker24h } from '@/lib/cache-service';
import { doAnalysisCore } from '@/lib/analysis-core';
import { sendGemAlert } from '@/lib/telegram';
import { insertScannerAlert, getSymbolsAlertedSince } from '@/lib/db/scanner-alert-log';
import { isSupportedBase } from '@/lib/symbols';
import { writeAudit } from '@/lib/audit';
import { getMacroPulse } from '@/lib/macro-service';

const SCAN_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
const RECENTLY_ALERTED_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_GEMS_PER_CYCLE = 12;
const DEFAULT_CONFIDENCE_THRESHOLD = 80;

export type ScannerStatus = 'ACTIVE' | 'IDLE';

export interface ScannerState {
  status: ScannerStatus;
  lastScanTime: string | null;
  lastHeartbeat: string | null;
  lastRunStats: {
    coinsChecked: number;
    gemsFound: number;
    alertsSent: number;
  } | null;
}

const state: ScannerState = {
  status: 'IDLE',
  lastScanTime: null,
  lastHeartbeat: null,
  lastRunStats: null,
};

let intervalId: ReturnType<typeof setInterval> | null = null;

export function getScannerState(): ScannerState {
  return { ...state, lastRunStats: state.lastRunStats ? { ...state.lastRunStats } : null };
}

/** Exported for Vercel Cron: triggers one full scan cycle. */
export async function runOneCycle(): Promise<void> {
  state.status = 'ACTIVE';
  let coinsChecked = 0;
  let gemsFound = 0;
  let alertsSent = 0;

  try {
    const [tickers, macro] = await Promise.all([
      getCachedGemsTicker24h(),
      getMacroPulse(),
    ]);
    const confidenceThreshold = macro.minimumConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const recentlyAlerted = new Set(getSymbolsAlertedSince(RECENTLY_ALERTED_WINDOW_MS));

    // Take top symbols by volume, ensure USDT and supported for analysis
    const candidates = tickers
      .filter((t) => t.symbol.endsWith('USDT'))
      .map((t) => t.symbol.replace('USDT', ''))
      .filter((base) => isSupportedBase(base))
      .slice(0, MAX_GEMS_PER_CYCLE)
      .map((base) => `${base}USDT`);

    coinsChecked = candidates.length;

    for (const symbol of candidates) {
      try {
        const result = await doAnalysisCore(symbol, Date.now(), false, { skipGemAlert: true });
        gemsFound += 1;

        const probability = result.data.probability ?? 0;
        const entryPrice = result.data.entry_price ?? 0;

        if (probability > confidenceThreshold && !recentlyAlerted.has(symbol)) {
          insertScannerAlert({
            symbol,
            prediction_id: result.data.id,
            probability,
            entry_price: entryPrice,
          });
          recentlyAlerted.add(symbol);

          const base = symbol.replace('USDT', '');
          const messageText =
            `💎 <b>ג'ם זוהה (אלגוריתם ה-AI)</b>\n\n` +
            `נכס: ${base}\nמחיר כניסה: $${entryPrice.toLocaleString()}\nהסתברות הצלחה: ${probability}%\nכיוון: ${result.data.predicted_direction}\n\nבחר פעולה:`;

          const sendResult = await sendGemAlert({
            symbol,
            entryPrice,
            amountUsd: 100,
            messageText,
          });

          if (sendResult.ok) {
            alertsSent += 1;
            writeAudit({ event: 'scanner.alert_sent', meta: { symbol, probability } });
          } else {
            writeAudit({ event: 'scanner.alert_failed', level: 'warn', meta: { symbol, error: sendResult.error } });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeAudit({ event: 'scanner.analysis_failed', level: 'warn', meta: { symbol, error: msg } });
      }
    }

    state.lastScanTime = new Date().toISOString();
    state.lastHeartbeat = new Date().toISOString();
    state.lastRunStats = { coinsChecked, gemsFound, alertsSent };

    console.log(
      `[Scanner] פעיל: נסרקו ${coinsChecked} מטבעות, נמצאו ${gemsFound} ג'מים, נשלחו ${alertsSent} התראות.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeAudit({ event: 'scanner.cycle_error', level: 'error', meta: { error: msg } });
    console.error('[Scanner] שגיאה במחזור סריקה:', msg);
    state.lastHeartbeat = new Date().toISOString();
    state.lastRunStats = { coinsChecked, gemsFound, alertsSent };
  } finally {
    state.status = 'IDLE';
  }
}

export function startMarketScanner(): void {
  if (intervalId != null) {
    return;
  }
  runOneCycle().catch(() => {});
  intervalId = setInterval(() => {
    runOneCycle().catch(() => {});
  }, SCAN_INTERVAL_MS);
  console.log('[Scanner] סורק השוק הופעל — ריצה כל 20 דקות.');
}

export function stopMarketScanner(): void {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
    state.status = 'IDLE';
    console.log('[Scanner] סורק השוק הופסק.');
  }
}
