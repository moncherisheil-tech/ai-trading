/**
 * Live Scanning Worker: scans market every 20 minutes, runs AI analysis on gems,
 * logs high-confidence predictions and sends Telegram alerts with simulation buttons.
 */

import { getCachedGemsTicker24h } from '@/lib/cache-service';
import { doAnalysisCore } from '@/lib/analysis-core';
import { sendGemAlert, sendEliteAlert } from '@/lib/telegram';
import { insertScannerAlert, getSymbolsAlertedSince, getLatestScannerAlertForSymbol } from '@/lib/db/scanner-alert-log';
import { isSupportedBase } from '@/lib/symbols';
import { writeAudit } from '@/lib/audit';
import { getMacroPulse, DEFAULT_MACRO } from '@/lib/macro-service';
import { getAppSettings, DEFAULT_APP_SETTINGS } from '@/lib/db/app-settings';
import { getMarketRiskSentiment, type MarketRiskSentiment } from '@/lib/market-sentinel';
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
const CONFIDENCE_JUMP_OVERRIDE = 15;
const MAX_GEMS_PER_CYCLE = 12;
const DEFAULT_CONFIDENCE_THRESHOLD = 80;
const PROFESSIONAL_MIN_24H_VOLUME_USD = 500_000;
/** Hard limit for the entire scan cycle (sequential: 12 symbols × ~155s + buffer). */
const SCAN_CYCLE_HARD_LIMIT_MS = 35 * 60 * 1000; // 35 minutes
/** Per-symbol analysis timeout (150s to avoid Groq rate-limit timeouts). */
const PER_SYMBOL_ANALYSIS_TIMEOUT_MS = 150_000;
/** Delay between each symbol (reduced when using cached macro/sentiment to avoid rate limits with fewer API calls). */
const DELAY_BETWEEN_SYMBOLS_MS = 1_500;

const SCANNER_FALLBACK_MARKET_RISK: MarketRiskSentiment = {
  status: 'SAFE',
  reasoning: 'שירות סנטימנט סיכון לא זמין — ממשיך בסריקה עם ברירת מחדל בטוחה.',
  btc24hVolatilityPct: null,
  eth24hVolatilityPct: null,
  btcAtrPct: null,
  ethAtrPct: null,
  checkedAt: new Date().toISOString(),
};

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

function formatTelegramPrice(value: number): string {
  if (!Number.isFinite(value)) return '0.0000';
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatTelegramPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
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
  console.log('[HEARTBEAT] Scanner diagnostics reset; next cycle treated as first production scan.');
}

// ────────────────────────────────────────────────────────────────────────────
// Extracted helpers — also used by the BullMQ enqueue route
// ────────────────────────────────────────────────────────────────────────────

export interface CandidateListResult {
  candidates: string[];
  macroCtx: Awaited<ReturnType<typeof runGlobalMacroExpertOnce>> | null;
  appSettings: Awaited<ReturnType<typeof getAppSettings>>;
  confidenceThreshold: number;
  marketSafetyStatus: 'Safe' | 'Caution' | 'Dangerous';
  defaultAmountUsd: number;
}

/**
 * Fetch, filter, and return the coin candidates for a scan cycle
 * together with the shared macro context.
 * Used by both runOneCycle() (legacy) and enqueueScanCycle() (queue mode).
 */
export async function buildCandidateList(): Promise<CandidateListResult> {
  const [s0, s1, s2] = await Promise.allSettled([
    getAppSettings(),
    getMacroPulse(),
    getMarketRiskSentiment(),
  ]);
  const appSettings = s0.status === 'fulfilled' ? s0.value : DEFAULT_APP_SETTINGS;
  if (s0.status === 'rejected') {
    const msg = s0.reason instanceof Error ? s0.reason.message : String(s0.reason);
    console.warn('[Scanner] getAppSettings failed; using DEFAULT_APP_SETTINGS.', msg);
    writeAudit({ event: 'scanner.app_settings_failed', level: 'warn', meta: { error: msg } });
  }
  const macro = s1.status === 'fulfilled' ? s1.value : DEFAULT_MACRO;
  if (s1.status === 'rejected') {
    const msg = s1.reason instanceof Error ? s1.reason.message : String(s1.reason);
    console.warn('[Scanner] getMacroPulse failed; using DEFAULT_MACRO.', msg);
    writeAudit({ event: 'scanner.macro_pulse_failed', level: 'warn', meta: { error: msg } });
  }
  const marketRisk =
    s2.status === 'fulfilled'
      ? s2.value
      : { ...SCANNER_FALLBACK_MARKET_RISK, checkedAt: new Date().toISOString() };
  if (s2.status === 'rejected') {
    const msg = s2.reason instanceof Error ? s2.reason.message : String(s2.reason);
    console.warn('[Scanner] getMarketRiskSentiment failed; using safe fallback.', msg);
    writeAudit({ event: 'scanner.market_risk_failed', level: 'warn', meta: { error: msg } });
  }

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

  let tickers: Awaited<ReturnType<typeof getCachedGemsTicker24h>> = [];
  try {
    tickers = await getCachedGemsTicker24h(scannerOpts);
  } catch (gemsErr) {
    const msg = gemsErr instanceof Error ? gemsErr.message : String(gemsErr);
    console.warn('[Scanner] getCachedGemsTicker24h failed; skipping gem candidates this cycle.', msg);
    writeAudit({ event: 'scanner.gems_fetch_failed', level: 'warn', meta: { error: msg } });
  }

  const candidates = tickers
    .filter((t) => t.symbol.endsWith('USDT'))
    .map((t) => t.symbol.replace('USDT', ''))
    .filter((base) => isSupportedBase(base))
    .slice(0, MAX_GEMS_PER_CYCLE)
    .map((base) => `${base}USDT`);

  let macroCtx: Awaited<ReturnType<typeof runGlobalMacroExpertOnce>> | null = null;
  try {
    const macroContext = await fetchMacroContext();
    const macroContextStr =
      macroContext.dxyNote +
      (macroContext.fearGreedIndex != null ? ` Fear & Greed: ${macroContext.fearGreedIndex} (${macroContext.fearGreedLabel ?? 'N/A'}).` : '') +
      (macroContext.btcDominancePct != null ? ` BTC dominance: ${macroContext.btcDominancePct}%.` : '');
    macroCtx = await runGlobalMacroExpertOnce(macroContextStr);
  } catch (macroErr) {
    console.warn('[Scanner] Global macro pre-fetch failed:', macroErr instanceof Error ? macroErr.message : macroErr);
  }

  return { candidates, macroCtx, appSettings, confidenceThreshold, marketSafetyStatus, defaultAmountUsd };
}

/**
 * Alias kept for backwards-compat with the enqueue route.
 * Returns candidates + macroCtx only.
 */
export async function buildCycleMacroContext(): Promise<{
  candidates: string[];
  macroCtx: Awaited<ReturnType<typeof runGlobalMacroExpertOnce>> | null;
}> {
  const { candidates, macroCtx } = await buildCandidateList();
  return { candidates, macroCtx };
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
    const {
      candidates,
      macroCtx: cycleMacroSummary,
      appSettings,
      confidenceThreshold,
      marketSafetyStatus,
      defaultAmountUsd,
    } = await buildCandidateList();

    coinsChecked = candidates.length;
    const simulationBaseUrl = getBaseUrl();
    const recentlyAlerted = new Set(await getSymbolsAlertedSince(RECENTLY_ALERTED_WINDOW_MS));

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

      if (probability <= confidenceThreshold) {
        belowThreshold += 1;
      } else {
        const latestAlert = await getLatestScannerAlertForSymbol(symbol);
        const latestAlertAgeMs = latestAlert?.alerted_at ? Date.now() - new Date(latestAlert.alerted_at).getTime() : Number.POSITIVE_INFINITY;
        const withinWindow = Number.isFinite(latestAlertAgeMs) && latestAlertAgeMs <= RECENTLY_ALERTED_WINDOW_MS;
        const confidenceJump = latestAlert ? probability - latestAlert.probability : Number.POSITIVE_INFINITY;
        const shouldSkipForIdempotency = Boolean(
          recentlyAlerted.has(symbol) &&
            withinWindow &&
            Number.isFinite(confidenceJump) &&
            confidenceJump < CONFIDENCE_JUMP_OVERRIDE
        );
        if (shouldSkipForIdempotency) {
          alreadyAlerted += 1;
          continue;
        }

        const alertPersisted = await insertScannerAlert({
          symbol,
          prediction_id: result.data.id,
          probability,
          entry_price: entryPrice,
        });
        if (!alertPersisted) {
          console.error('[MARKET_SCANNER] Scanner alert DB insert failed; skipping Telegram dispatch', { symbol });
          writeAudit({
            event: 'scanner.alert_log_failed',
            level: 'error',
            meta: { symbol, probability },
          });
          continue;
        }
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
            takeProfitPct: Math.abs(targetPct) > 0.005 ? Math.abs(targetPct) : undefined,
            stopLossPct: -1.5,
          });
          if (sendResult.ok) {
            alertsSent += 1;
            writeAudit({ event: 'scanner.elite_alert_sent', meta: { symbol, probability } });
          } else {
            writeAudit({ event: 'scanner.elite_alert_failed', level: 'warn', meta: { symbol, error: sendResult.error } });
          }
        } else {
          const messageText = [
            '🔔 *התראת סורק — פעולה מומלצת*',
            '━━━━━━━━━━━━━━━━',
            `📌 *נכס:* ${base}`,
            `📊 *עוצמת אות:* \`${formatTelegramPercent(probability)}%\``,
            `🛡 *פרופיל סיכון:* ${riskLabel}`,
            '',
            '📍 *רמות מפתח*',
            `• כניסה: \`${formatTelegramPrice(entryPrice)}\``,
            `• יעד: \`${formatTelegramPrice(targetPrice)}\``,
            `• תמיכה / ביטול: \`${formatTelegramPrice(supportPrice)}\``,
            '',
            '🧠 *תמצית*',
            (logicSnippet || 'אין תמליל תזה זמין — בדוק בגרף ובמסוף.').slice(0, 320),
            '',
            '━━━━━━━━━━━━━━━━',
            '_פעולה:_ גרף · אישור/דחייה · ניתוח מעמיק',
          ].join('\n');

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
      console.log('[HEARTBEAT] Scanner cycle: zero gems —', summaryWhenZeroGems);
    }
    console.log(
      `[HEARTBEAT] Scanner cycle: checked=${coinsChecked} gems=${gemsFound} alerts=${alertsSent}`
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

/**
 * @deprecated Use BullMQ repeatable jobs instead (setupAutoScanner in queue-worker.ts).
 * This function is kept for backwards compatibility with legacy HTTP endpoints.
 * No-op when running the PM2 queue worker with QUEUE_ENABLED=true.
 */
export function startMarketScanner(): void {
  console.log('[HEARTBEAT] startMarketScanner() deprecated — using BullMQ repeatable jobs instead.');
}

/**
 * @deprecated Use BullMQ repeatable jobs instead.
 * This function is kept for backwards compatibility.
 */
export function stopMarketScanner(): void {
  console.log('[HEARTBEAT] stopMarketScanner() deprecated — no-op (handled by BullMQ worker).');
}
