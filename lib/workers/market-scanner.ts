/**
 * Live Scanning Worker: scans market every 20 minutes, runs AI analysis on gems,
 * logs high-confidence predictions and sends Telegram alerts with simulation buttons.
 */

import { getCachedGemsTicker24h } from '@/lib/cache-service';
import { doAnalysisCore } from '@/lib/analysis-core';
import { sendGemAlert, sendEliteAlert, escapeHtml } from '@/lib/telegram';
import { insertScannerAlert, getSymbolsAlertedSince } from '@/lib/db/scanner-alert-log';
import { isSupportedBase } from '@/lib/symbols';
import { writeAudit } from '@/lib/audit';
import { getMacroPulse } from '@/lib/macro-service';
import { getAppSettings } from '@/lib/db/app-settings';
import { getMarketRiskSentiment } from '@/lib/market-sentinel';
import { getBaseUrl } from '@/lib/config';
import { insertAgentInsight } from '@/lib/db/agent-insights';
import { checkRiskThresholds } from '@/lib/portfolio-logic';
import { listOpenVirtualTrades } from '@/lib/db/virtual-portfolio';
import { fetchBinanceTickerPrices, fetchMacroContext } from '@/lib/api-utils';
import { toDecimal, round2 } from '@/lib/decimal';
import { sendWorkerFailureAlert } from '@/lib/worker-alerts';
import { runGlobalMacroExpertOnce } from '@/lib/consensus-engine';

const ELITE_CONFIDENCE_THRESHOLD = 85;

const SCAN_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

const RECENTLY_ALERTED_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_GEMS_PER_CYCLE = 12;
const DEFAULT_CONFIDENCE_THRESHOLD = 80;
const PROFESSIONAL_MIN_24H_VOLUME_USD = 500_000;
/** Hard limit for the entire scan cycle (sequential: 12 symbols × ~155s + buffer). */
const SCAN_CYCLE_HARD_LIMIT_MS = 35 * 60 * 1000; // 35 minutes
/** Per-symbol analysis timeout (150s to avoid Groq rate-limit timeouts). */
const PER_SYMBOL_ANALYSIS_TIMEOUT_MS = 150_000;
/** Delay between each symbol (reduced when using cached macro/sentiment to avoid rate limits with fewer API calls). */
const DELAY_BETWEEN_SYMBOLS_MS = 1_500;

/** Build human-readable diagnostics: why no gems (e.g. filtered by RSI/confidence, analysis failed, already alerted). */
function buildScannerDiagnosticsSummary(
  coinsChecked: number,
  analysisFailed: number,
  belowThreshold: number,
  alreadyAlerted: number
): string {
  const parts: string[] = [];
  parts.push(`${coinsChecked} מטבעות נסרקו`);
  if (analysisFailed > 0) parts.push(`${analysisFailed} נכשלו בניתוח (API/מודל)`);
  if (belowThreshold > 0) parts.push(`${belowThreshold} סוננו עקב הסתברות נמוכה או תנאי RSI/שוק (מתחת לסף ביטחון)`);
  if (alreadyAlerted > 0) parts.push(`${alreadyAlerted} כבר קיבלו התראה לאחרונה`);
  return parts.join('; ') + '.';
}

export type ScannerStatus = 'ACTIVE' | 'IDLE';

/** Diagnostics: why 0 gems (e.g. volume filter, analysis failed, below threshold, already alerted). */
export interface ScannerDiagnostics {
  coinsChecked: number;
  analysisFailed: number;
  belowThreshold: number;
  alreadyAlerted: number;
  gemsFound: number;
  alertsSent: number;
  /** Human-readable summary when 0 gems: "15 coins checked: 10 failed Volume threshold, 5 failed RSI/EMA conditions" */
  summaryWhenZeroGems: string | null;
}

export interface ScannerState {
  status: ScannerStatus;
  lastScanTime: string | null;
  lastHeartbeat: string | null;
  lastRunStats: {
    coinsChecked: number;
    gemsFound: number;
    alertsSent: number;
  } | null;
  lastDiagnostics: ScannerDiagnostics | null;
}

const state: ScannerState = {
  status: 'IDLE',
  lastScanTime: null,
  lastHeartbeat: null,
  lastRunStats: null,
  lastDiagnostics: null,
};

let intervalId: ReturnType<typeof setInterval> | null = null;

export function getScannerState(): ScannerState {
  return {
    ...state,
    lastRunStats: state.lastRunStats ? { ...state.lastRunStats } : null,
    lastDiagnostics: state.lastDiagnostics ? { ...state.lastDiagnostics } : null,
  };
}

/**
 * Reset in-memory scanner diagnostics so the next run is treated as the first production cycle.
 * Call before production launch to ensure lastDiagnostics/lastScanTime reflect only post-launch data.
 */
export function resetScannerDiagnostics(): void {
  state.lastDiagnostics = null;
  state.lastScanTime = null;
  state.lastRunStats = null;
  state.lastHeartbeat = null;
  console.log('[Scanner] אבחון אופס — המחזור הבא ייחשב כסריקה ראשונה.');
}

/** Exported for Vercel Cron: triggers one full scan cycle. */
export async function runOneCycle(): Promise<void> {
  state.status = 'ACTIVE';
  let coinsChecked = 0;
  let gemsFound = 0;
  let alertsSent = 0;
  let analysisFailed = 0;
  let belowThreshold = 0;
  let alreadyAlerted = 0;

  try {
    const [appSettings, macro, marketRisk] = await Promise.all([
      getAppSettings(),
      getMacroPulse(),
      getMarketRiskSentiment(),
    ]);
    const defaultAmountUsd = appSettings.trading?.defaultTradeSizeUsd ?? appSettings.risk.defaultPositionSizeUsd ?? 100;
    const marketSafetyStatus: 'Safe' | 'Caution' | 'Dangerous' =
      marketRisk.status === 'SAFE' ? 'Safe' : marketRisk.status === 'DANGEROUS' ? 'Dangerous' : 'Caution';

    const confidenceThreshold =
      appSettings.scanner.aiConfidenceThreshold ??
      macro.minimumConfidenceThreshold ??
      DEFAULT_CONFIDENCE_THRESHOLD;
    const scannerOpts = {
      minVolume24hUsd: Math.max(appSettings.scanner.minVolume24hUsd ?? 0, PROFESSIONAL_MIN_24H_VOLUME_USD),
      minLiquidityUsd: 50_000,
      minPriceChangePct: appSettings.scanner.minPriceChangePctForGem,
    };
    const tickers = await getCachedGemsTicker24h(scannerOpts);
    const recentlyAlerted = new Set(await getSymbolsAlertedSince(RECENTLY_ALERTED_WINDOW_MS));

    const candidates = tickers
      .filter((t) => t.symbol.endsWith('USDT'))
      .map((t) => t.symbol.replace('USDT', ''))
      .filter((base) => isSupportedBase(base))
      .slice(0, MAX_GEMS_PER_CYCLE)
      .map((base) => `${base}USDT`);

    coinsChecked = candidates.length;
    const simulationBaseUrl = getBaseUrl();

    // Pre-fetch global macro context and run Macro Expert once per cycle (reused for all symbols to avoid 12 Groq calls and rate limits).
    let cycleMacroSummary: Awaited<ReturnType<typeof runGlobalMacroExpertOnce>> | null = null;
    try {
      const macroContext = await fetchMacroContext();
      const macroContextStr =
        macroContext.dxyNote +
        (macroContext.fearGreedIndex != null ? ` Fear & Greed: ${macroContext.fearGreedIndex} (${macroContext.fearGreedLabel ?? 'N/A'}).` : '') +
        (macroContext.btcDominancePct != null ? ` BTC dominance: ${macroContext.btcDominancePct}%.` : '');
      cycleMacroSummary = await runGlobalMacroExpertOnce(macroContextStr);
    } catch (macroErr) {
      console.warn('[Scanner] Global macro pre-fetch failed, each symbol will call Macro Expert:', macroErr instanceof Error ? macroErr.message : macroErr);
    }

    // Sequential execution: one symbol at a time with delay between to avoid rate limiting.
    type SymbolOutcome =
      | { symbol: string; result: Awaited<ReturnType<typeof doAnalysisCore>> }
      | { symbol: string; error: unknown };
    const completedOutcomes: SymbolOutcome[] = [];
    const cycleStart = Date.now();

    for (let i = 0; i < candidates.length; i++) {
      if (Date.now() - cycleStart >= SCAN_CYCLE_HARD_LIMIT_MS) {
        console.warn(
          `[Scanner] Scan cycle hit ${SCAN_CYCLE_HARD_LIMIT_MS / 1000}s limit; stopping after ${completedOutcomes.length}/${candidates.length} symbols.`
        );
        writeAudit({
          event: 'scanner.cycle_timeout',
          level: 'warn',
          meta: { completed: completedOutcomes.length, total: candidates.length },
        });
        break;
      }
      const symbol = candidates[i]!;
      if (i > 0) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SYMBOLS_MS));
      }
      try {
        const result = await Promise.race([
          doAnalysisCore(symbol, Date.now(), false, {
            skipGemAlert: true,
            precomputedMacro: cycleMacroSummary ?? undefined,
          }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('Analysis timeout')), PER_SYMBOL_ANALYSIS_TIMEOUT_MS)
          ),
        ]);
        completedOutcomes.push({ symbol, result });
      } catch (err) {
        completedOutcomes.push({ symbol, error: err });
      }
    }

    for (const outcome of completedOutcomes) {
      if ('error' in outcome) {
        analysisFailed += 1;
        const msg =
          outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
        console.error('[SIMULATION_AGENT_ERROR] Market Risk analysis failed:', {
          symbol: outcome.symbol,
          error: msg,
        });
        writeAudit({ event: 'scanner.analysis_failed', level: 'warn', meta: { symbol: outcome.symbol, error: msg } });
        if (marketSafetyStatus === 'Dangerous') {
          insertAgentInsight({
            symbol: outcome.symbol,
            trade_id: 0,
            insight: `סיכון שוק (Market Risk): ניתוח נכשל עבור ${outcome.symbol} בתנאי שוק מסוכנים — ${msg}`,
            outcome: 'analysis_failed_dangerous_market',
          }).catch(() => {});
        }
        continue;
      }

      const { symbol, result } = outcome;
      gemsFound += 1;

      const probability = result.data.probability ?? 0;
      const entryPrice = result.data.entry_price ?? 0;

      if (recentlyAlerted.has(symbol)) {
        alreadyAlerted += 1;
      } else if (probability <= confidenceThreshold) {
        belowThreshold += 1;
      } else {
        await insertScannerAlert({
          symbol,
          prediction_id: result.data.id,
          probability,
          entry_price: entryPrice,
        });
        recentlyAlerted.add(symbol);

        const base = symbol.replace('USDT', '');
        const dir = result.data.predicted_direction;
        const targetPct = result.data.target_percentage ?? 0;
        const entryD = toDecimal(entryPrice);
        const targetPrice =
          dir === 'Bullish'
            ? round2(entryD.times(1 + targetPct / 100))
            : dir === 'Bearish'
              ? round2(entryD.times(1 - targetPct / 100))
              : round2(entryD);
        const supportPrice =
          dir === 'Bullish' ? round2(entryD.times(0.98)) : dir === 'Bearish' ? round2(entryD.times(1.02)) : entryPrice;
        const riskLabel = result.data.risk_level_he ?? 'בינוני';
        const logicSnippet = (result.data.logic ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 280);
        const logicEscaped = escapeHtml(logicSnippet || 'אין תזה זמינה.');

        const trendConfirmed = (result.data.trend_confirmed_timeframes ?? 0) >= 2;
        const isElite = probability >= ELITE_CONFIDENCE_THRESHOLD && trendConfirmed;
        const reasoning = result.data.logic ?? result.data.strategic_advice ?? '';

        if (isElite) {
          const sendResult = await sendEliteAlert({
            symbol,
            entryPrice,
            amountUsd: defaultAmountUsd,
            confidence: probability,
            reasoning: reasoning.slice(0, 400),
            marketSafetyStatus,
            simulationLink: `${simulationBaseUrl}/ops`,
            gemScore: result.data.final_confidence,
            masterInsightHe: result.data.master_insight_he,
            macroLogicHe: result.data.macro_logic,
            onchainLogicHe: result.data.onchain_logic ?? undefined,
            deepMemoryLogicHe: result.data.deep_memory_logic ?? undefined,
          });
          if (sendResult.ok) {
            alertsSent += 1;
            writeAudit({ event: 'scanner.elite_alert_sent', meta: { symbol, probability } });
          } else {
            writeAudit({ event: 'scanner.elite_alert_failed', level: 'warn', meta: { symbol, error: sendResult.error } });
          }
        } else {
          const messageText =
            `🚨 <b>Mon Chéri Quant AI | זיהוי הזדמנות</b> 🚨\n\n` +
            `💎 <b>נכס:</b> ${escapeHtml(base)}\n` +
            `📊 <b>הסתברות הצלחה:</b> ${probability}% | <b>סיכון:</b> ${escapeHtml(riskLabel)}\n\n` +
            `🎯 <b>מחיר יעד:</b> $${targetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
            `🛑 <b>תמיכה קריטית:</b> $${supportPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n` +
            `🧠 <b>תזת ה-AI:</b>\n${logicEscaped}\n\nבחר פעולה:`;

          const sendResult = await sendGemAlert({
            symbol,
            entryPrice,
            amountUsd: defaultAmountUsd,
            messageText,
          });

          if (sendResult.ok) {
            alertsSent += 1;
            writeAudit({ event: 'scanner.alert_sent', meta: { symbol, probability } });
          } else {
            writeAudit({ event: 'scanner.alert_failed', level: 'warn', meta: { symbol, error: sendResult.error } });
          }
        }
      }
    }

    const summaryWhenZeroGems =
      gemsFound === 0 && coinsChecked > 0
        ? buildScannerDiagnosticsSummary(coinsChecked, analysisFailed, belowThreshold, alreadyAlerted)
        : null;

    // Exposure Sentinel: post-scan risk check (virtual portfolio)
    try {
      const openTrades = await listOpenVirtualTrades();
      const symbols = openTrades.map((t) => t.symbol);
      const prices = symbols.length > 0 ? await fetchBinanceTickerPrices(symbols, 8_000) : new Map<string, number>();
      const positions = openTrades.map((t) => {
        const currentPrice = prices.get(t.symbol) ?? t.entry_price;
        const entryD = toDecimal(t.entry_price);
        const amountUsdD = toDecimal(t.amount_usd);
        const currentValueUsd =
          entryD.gt(0) ? round2(amountUsdD.times(currentPrice).div(entryD)) : amountUsdD.toNumber();
        const amountAsset = entryD.gt(0) ? round2(amountUsdD.div(entryD)) : 0;
        return { symbol: t.symbol, currentValueUsd, amountAsset, costUsd: t.amount_usd };
      });
      const refLiquid = 10_000;
      const sentinelResult = await checkRiskThresholds(
        { liquidBalanceUsd: refLiquid, positions },
        {
          maxExposurePct: appSettings.risk.globalMaxExposurePct ?? 70,
          maxConcentrationPct: appSettings.risk.singleAssetConcentrationLimitPct ?? 20,
        }
      );
      if (sentinelResult.triggered) {
        writeAudit({ event: 'scanner.exposure_sentinel_triggered', level: 'warn', meta: { totalExposurePct: sentinelResult.totalExposurePct, maxConcentrationPct: sentinelResult.maxConcentrationPct } });
      }
    } catch (sentinelErr) {
      writeAudit({ event: 'scanner.exposure_sentinel_error', level: 'warn', meta: { error: sentinelErr instanceof Error ? sentinelErr.message : String(sentinelErr) } });
    }

    state.lastScanTime = new Date().toISOString();
    state.lastHeartbeat = new Date().toISOString();
    state.lastRunStats = { coinsChecked, gemsFound, alertsSent };
    state.lastDiagnostics = {
      coinsChecked,
      analysisFailed,
      belowThreshold,
      alreadyAlerted,
      gemsFound,
      alertsSent,
      summaryWhenZeroGems,
    };

    if (summaryWhenZeroGems) {
      console.log('[Scanner] אבחון (אין ג\'מים):', summaryWhenZeroGems);
    }
    console.log(
      `[Scanner] פעיל: נסרקו ${coinsChecked} מטבעות, נמצאו ${gemsFound} ג'מים, נשלחו ${alertsSent} התראות.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeAudit({ event: 'scanner.cycle_error', level: 'error', meta: { error: msg } });
    console.error('[Scanner] שגיאה במחזור סריקה:', msg);
    await sendWorkerFailureAlert('scanner', err);
    state.lastHeartbeat = new Date().toISOString();
    state.lastRunStats = { coinsChecked, gemsFound, alertsSent };
    state.lastDiagnostics = {
      coinsChecked,
      analysisFailed,
      belowThreshold,
      alreadyAlerted,
      gemsFound,
      alertsSent,
      summaryWhenZeroGems: coinsChecked > 0 ? buildScannerDiagnosticsSummary(coinsChecked, analysisFailed, belowThreshold, alreadyAlerted) : null,
    };
    state.lastScanTime = new Date().toISOString();
  } finally {
    state.status = 'IDLE';
  }
}

export function startMarketScanner(): void {
  if (intervalId != null) {
    return;
  }
  runOneCycle().catch((err) => {
    void sendWorkerFailureAlert('scanner.startup', err);
  });
  intervalId = setInterval(() => {
    runOneCycle().catch((err) => {
      void sendWorkerFailureAlert('scanner.interval', err);
    });
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
