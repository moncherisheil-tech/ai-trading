import { APP_CONFIG } from '@/lib/config';
import { fetchWithBackoff } from '@/lib/api-utils';
import { computeRSI } from '@/lib/prediction-formula';
import { runConsensusEngine, sleep, type ConsensusResult } from '@/lib/consensus-engine';
import {
  computeEmaSeries,
  computeBollingerSeries,
  inferMarketStructure,
  buildTechnicalContext,
  type MarketStructure,
} from '@/lib/quant/technical-context';
import {
  fetchOpenInterest,
  getOIEnrichmentForCandle,
  formatOISignal,
  type OpenInterestRow as OIRow,
  type RawKlineRow as QuantKlineRow,
} from '@/lib/quant/open-interest';

type Direction = 'Bullish' | 'Bearish' | 'Neutral';

type BacktestOutcome = 'WIN' | 'LOSS' | 'SKIP';

export interface BacktestRequest {
  symbol: string;
  startDate?: string | number;
  endDate?: string | number;
}

export interface BacktestPoint {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rsi14: number;
  volatilityPct: number;
  consensus: ConsensusResult;
  direction: Direction;
  confidence: number;
  futureCloseTime?: number;
  futureClosePrice?: number;
  futureMovePct24h?: number | null;
  outcome: BacktestOutcome;
}

export interface ExpertStats {
  wins: number;
  losses: number;
  total: number;
  accuracyPct: number;
}

export interface BacktestReport {
  symbol: string;
  startDate: string;
  endDate: string;
  totalPredictions: number;
  wins: number;
  losses: number;
  accuracyPct: number;
  netPnLPct: number;
  feeRatePct: number;
  points: BacktestPoint[];
  expertPerformance: {
    technician: ExpertStats;
    risk: ExpertStats;
    psych: ExpertStats;
    macro: ExpertStats;
    onchain: ExpertStats;
    deepMemory: ExpertStats;
    bestExpertKey: keyof BacktestReport['expertPerformance'] | null;
  };
}

/** Klines shape for backtest; same as quant RawKlineRow. */
type RawKlineRow = QuantKlineRow;

/** Binance Futures open interest history row (4h period aligned with candles). Re-exported from shared quant. */
export type OpenInterestRow = OIRow;

function normalizeSymbol(symbol: string): string | null {
  const s = (symbol || '').trim().toUpperCase();
  if (!s || s === 'USDT') return null;
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

function isValidBinanceRow(row: unknown): row is [number, string, string, string, string, string] {
  return (
    Array.isArray(row) &&
    row.length >= 6 &&
    typeof row[0] === 'number' &&
    typeof row[1] === 'string' &&
    typeof row[2] === 'string' &&
    typeof row[3] === 'string' &&
    typeof row[4] === 'string' &&
    typeof row[5] === 'string'
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export async function fetch4hKlines(
  symbol: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<RawKlineRow[]> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const klines: RawKlineRow[] = [];
  // Ensure integer millisecond timestamps
  const finalStart = Math.floor(startTimeMs);
  const finalEnd = Math.floor(endTimeMs);
  let from = finalStart;

  // Binance 4h limit per request (max 1000 candles).
  const limit = 1000;

  while (from < finalEnd) {
    const url = `${base.replace(
      /\/$/,
      ''
    )}/api/v3/klines?symbol=${encodeURIComponent(
      symbol
    )}&interval=4h&limit=${limit}&startTime=${from}&endTime=${finalEnd}`;
    const res = await fetchWithBackoff(url, {
      timeoutMs: APP_CONFIG.fetchTimeoutMs,
      maxRetries: 3,
      cache: 'no-store',
    });
    if (!res.ok) {
      break;
    }
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json) || json.length === 0) {
      break;
    }
    const batch = (json as unknown[])
      .filter(isValidBinanceRow)
      .map((r) => ({
        openTime: r[0] as number,
        open: parseFloat(r[1] as string),
        high: parseFloat(r[2] as string),
        low: parseFloat(r[3] as string),
        close: parseFloat(r[4] as string),
        volume: parseFloat(r[5] as string),
      }));
    if (batch.length === 0) {
      break;
    }
    klines.push(...batch);
    const lastOpenTime = batch[batch.length - 1]!.openTime;
    const next = Math.floor(lastOpenTime + 4 * 60 * 60 * 1000);
    if (next <= from) {
      break;
    }
    from = next;
  }

  return klines.filter((k) => k.openTime >= finalStart && k.openTime <= finalEnd);
}

/**
 * Direction from institutional MoE (Mixture of Experts) gem score.
 * Bullish when final_confidence >= 55, Bearish when <= 45, else Neutral.
 */
function inferDirection(_rsi14: number, consensus: ConsensusResult): Direction {
  const gem = consensus.final_confidence;
  if (!Number.isFinite(gem)) return 'Neutral';
  if (gem >= 55) return 'Bullish';
  if (gem <= 45) return 'Bearish';
  return 'Neutral';
}

function classifyOutcome(direction: Direction, movePct: number | null | undefined): BacktestOutcome {
  if (!movePct && movePct !== 0) return 'SKIP';
  if (direction === 'Neutral') return 'SKIP';

  if (direction === 'Bullish') {
    return movePct > 0 ? 'WIN' : 'LOSS';
  }
  if (direction === 'Bearish') {
    return movePct < 0 ? 'WIN' : 'LOSS';
  }
  return 'SKIP';
}

function updateExpertStats(
  stats: ExpertStats,
  expertScore: number,
  movePct: number,
  threshold = 55
): void {
  if (!Number.isFinite(expertScore)) return;
  const bullishLeaning = expertScore >= threshold;
  const correct = (bullishLeaning && movePct > 0) || (!bullishLeaning && movePct < 0);
  if (correct) {
    stats.wins += 1;
  } else {
    stats.losses += 1;
  }
  stats.total += 1;
}

function finalizeExpertStats(stats: ExpertStats): ExpertStats {
  const total = stats.total || 0;
  const accuracyPct = total > 0 ? (stats.wins / total) * 100 : 0;
  return { ...stats, accuracyPct: Math.round(accuracyPct * 10) / 10 };
}

export async function runBacktest({
  symbol,
  startDate,
  endDate,
}: BacktestRequest): Promise<BacktestReport> {
  const DEFAULT_START = '2025-10-15T00:00:00Z';
  const DEFAULT_END = '2025-12-31T23:59:59Z';

  const toMs = (value: string | number | undefined, fallbackIso: string): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.floor(value);
    }
    const str = (value ?? '').toString().trim() || fallbackIso;
    const ms = Math.floor(new Date(str).getTime());
    return ms;
  };

  const cleanSymbol = normalizeSymbol(symbol || '');
  if (!cleanSymbol) {
    console.warn('[Backtest] Skipping invalid or empty symbol for backtest:', symbol);
    const startTimeMs = toMs(startDate, DEFAULT_START);
    const endTimeMs = toMs(endDate, DEFAULT_END);

    const emptyStats: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };

    return {
      symbol: symbol || '',
      startDate: new Date(startTimeMs).toISOString(),
      endDate: new Date(endTimeMs).toISOString(),
      totalPredictions: 0,
      wins: 0,
      losses: 0,
      accuracyPct: 0,
      netPnLPct: 0,
      feeRatePct: 0.2,
      points: [],
      expertPerformance: {
        technician: { ...emptyStats },
        risk: { ...emptyStats },
        psych: { ...emptyStats },
        macro: { ...emptyStats },
        onchain: { ...emptyStats },
        deepMemory: { ...emptyStats },
        bestExpertKey: null,
      },
    };
  }

  const startTimeMs = toMs(startDate, DEFAULT_START);
  const endTimeMs = toMs(endDate, DEFAULT_END);
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || startTimeMs >= endTimeMs) {
    throw new Error('Invalid startDate/endDate for backtest.');
  }

  const klines = await fetch4hKlines(cleanSymbol, startTimeMs, endTimeMs);
  if (klines.length < 10) {
    throw new Error('Not enough 4h candles to run backtest.');
  }

  let oiRows: OpenInterestRow[] = [];
  try {
    oiRows = await fetchOpenInterest(cleanSymbol, startTimeMs, endTimeMs);
  } catch (oiErr) {
    console.warn('[Backtest] Open Interest fetch failed, continuing without OI.', oiErr instanceof Error ? oiErr.message : String(oiErr));
  }

  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);

  const ema20Series = computeEmaSeries(closes, 20);
  const ema50Series = computeEmaSeries(closes, 50);
  const ema200Series = computeEmaSeries(closes, 200);
  const bb = computeBollingerSeries(closes, 20, 2);

  const rsiSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const window = closes.slice(0, i + 1);
    const rsi = computeRSI(window, 14);
    rsiSeries.push(rsi);
  }

  const points: BacktestPoint[] = [];
  const neutralConsensusFallback = (): ConsensusResult => ({
    tech_score: 50,
    risk_score: 50,
    psych_score: 50,
    macro_score: 50,
    onchain_score: 50,
    deep_memory_score: 50,
    tech_logic: 'Neutral expert fallback (backtest error).',
    risk_logic: 'Neutral expert fallback (backtest error).',
    psych_logic: 'Neutral expert fallback (backtest error).',
    macro_logic: 'Neutral expert fallback (backtest error).',
    onchain_logic: 'Neutral expert fallback (backtest error).',
    deep_memory_logic: 'Neutral expert fallback (backtest error).',
    master_insight_he: 'תובנת AI לא זמינה עבור נר זה — חוזה לנייטרלי בלבד.',
    reasoning_path: 'Backtest engine applied neutral fallback after AI pipeline error.',
    final_confidence: 50,
    consensus_approved: false,
  });

  const batchSize = 5;
  let batchPromises: Promise<void>[] = [];
  const totalCandlesToAnalyze = klines.reduce(
    (sum, _, idx) => sum + (Number.isFinite(rsiSeries[idx]) ? 1 : 0),
    0
  );
  let processedCount = 0;

  const logProgress = () => {
    const pct =
      totalCandlesToAnalyze > 0
        ? Math.round((processedCount / totalCandlesToAnalyze) * 100)
        : 0;
    process.stdout.write(
      `\r[Backtest Progress] ${cleanSymbol}: ${pct}% complete (${processedCount}/${totalCandlesToAnalyze} candles analyzed).    `
    );
  };

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i]!;
    const rsi14 = rsiSeries[i]!;
    if (!Number.isFinite(rsi14)) {
      continue;
    }

    const task = (async () => {
      const volatilityPct =
        k.close > 0 ? ((k.high - k.low) / k.close) * 100 : 0;
      const volatility_pct = volatilityPct;

      const hvn_levels: number[] = [];
      const nearest_sr_distance_pct: number | null = null;
      const volume_profile_summary = 'Backtest 4h engine — no HVN profile (lightweight mode).';

      const ema20 = ema20Series[i] ?? null;
      const ema50 = ema50Series[i] ?? null;
      const ema200 = ema200Series[i] ?? null;
      const marketStructure = inferMarketStructure({ highs, lows, idx: i, window: 20 });
      const bbMid = bb.mid[i] ?? null;
      const bbUpper = bb.upper[i] ?? null;
      const bbLower = bb.lower[i] ?? null;
      const bbPercentB = bb.percentB[i] ?? null;
      const oiEnrichment = getOIEnrichmentForCandle(k.openTime, klines, oiRows);
      const { technicalContextTextHe, assetMomentumTextHe } = buildTechnicalContext({
        idx: i,
        close: k.close,
        ema20,
        ema50,
        ema200,
        bbMid,
        bbUpper,
        bbLower,
        bbPercentB,
        marketStructure,
        oiStatus: oiEnrichment.oiStatus,
        oiChangePct: oiEnrichment.oiChangePct,
      });
      const openInterestSignal = formatOISignal(oiEnrichment);

      let consensus: ConsensusResult;
      try {
        consensus = await runConsensusEngine(
          {
            symbol: cleanSymbol,
            current_price: k.close,
            rsi_14: rsi14,
            atr_value: null,
            atr_pct_of_price: null,
            macd_signal: null,
            volume_profile_summary,
            hvn_levels,
            nearest_sr_distance_pct,
            volatility_pct,
            btc_trend: undefined,
            asset_momentum: assetMomentumTextHe,
            technical_context: technicalContextTextHe,
            open_interest_signal: openInterestSignal,
            funding_rate_signal: null,
            liquidity_sweep_context: null,
            onchain_metric_shift: null,
            social_dominance_volume: null,
            twitter_realtime_tweets: null,
            macro_context: null,
          },
          {
            moeConfidenceThreshold: undefined,
          }
        );
      } catch (err) {
        console.warn('[Backtest] Consensus engine failed for candle, using neutral fallback.', {
          symbol: cleanSymbol,
          openTime: k.openTime,
          error: err instanceof Error ? err.message : String(err),
        });
        consensus = neutralConsensusFallback();
      }

      const direction = inferDirection(rsi14, consensus);
      const confidence = consensus.final_confidence;

      const futureIdx = i + 6;
      const future = futureIdx < klines.length ? klines[futureIdx] : undefined;
      const futureMovePct24h =
        future && k.close > 0
          ? ((future.close - k.close) / k.close) * 100
          : null;

      const outcome = classifyOutcome(direction, futureMovePct24h);

      points.push({
        openTime: k.openTime,
        closeTime: k.openTime + 4 * 60 * 60 * 1000,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        rsi14,
        volatilityPct,
        consensus,
        direction,
        confidence,
        futureCloseTime: future?.openTime,
        futureClosePrice: future?.close,
        futureMovePct24h,
        outcome,
      });
    })();

    batchPromises.push(task);

    if (batchPromises.length === batchSize) {
      await Promise.all(batchPromises);
      processedCount += batchPromises.length;
      logProgress();
      batchPromises = [];
      await sleep(1500);
    }
  }

  if (batchPromises.length > 0) {
    await Promise.all(batchPromises);
    processedCount += batchPromises.length;
    logProgress();
  }
  process.stdout.write('\n');

  points.sort((a, b) => a.openTime - b.openTime);

  const actionable = points.filter((p) => p.outcome !== 'SKIP');
  const wins = actionable.filter((p) => p.outcome === 'WIN').length;
  const losses = actionable.filter((p) => p.outcome === 'LOSS').length;
  const totalPredictions = actionable.length;
  const accuracyPct =
    totalPredictions > 0 ? (wins / totalPredictions) * 100 : 0;

  // 0.2% per side → 0.4% round-trip (institutional fee assumption)
  const feeRatePct = 0.2;
  const round = (v: number) => Math.round(v * 100) / 100;

  let netPnLPct = 0;
  for (const p of actionable) {
    if (p.futureMovePct24h == null) continue;
    const grossMove =
      p.direction === 'Bullish'
        ? p.futureMovePct24h
        : p.direction === 'Bearish'
          ? -p.futureMovePct24h
          : 0;
    const totalFees = 2 * feeRatePct; // 0.4% round-trip
    const netMove = grossMove - totalFees;
    netPnLPct += netMove;
  }

  const tech: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const risk: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const psych: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const macro: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const onchain: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const deepMemory: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };

  for (const p of actionable) {
    if (p.futureMovePct24h == null) continue;
    const move = p.futureMovePct24h;
    updateExpertStats(tech, p.consensus.tech_score, move);
    updateExpertStats(risk, p.consensus.risk_score, move);
    updateExpertStats(psych, p.consensus.psych_score, move);
    updateExpertStats(macro, p.consensus.macro_score, move);
    updateExpertStats(onchain, p.consensus.onchain_score, move);
    updateExpertStats(deepMemory, p.consensus.deep_memory_score, move);
  }

  const expertPerformance = {
    technician: finalizeExpertStats(tech),
    risk: finalizeExpertStats(risk),
    psych: finalizeExpertStats(psych),
    macro: finalizeExpertStats(macro),
    onchain: finalizeExpertStats(onchain),
    deepMemory: finalizeExpertStats(deepMemory),
    bestExpertKey: null as keyof BacktestReport['expertPerformance'] | null,
  };

  let bestKey: keyof typeof expertPerformance | null = null;
  let bestAcc = -1;
  (Object.keys(expertPerformance) as (keyof typeof expertPerformance)[]).forEach((k) => {
    if (k === 'bestExpertKey') return;
    const acc = expertPerformance[k].accuracyPct;
    if (acc > bestAcc && expertPerformance[k].total > 0) {
      bestAcc = acc;
      bestKey = k;
    }
  });
  expertPerformance.bestExpertKey = bestKey;

  return {
    symbol: cleanSymbol,
    startDate: new Date(startTimeMs).toISOString(),
    endDate: new Date(endTimeMs).toISOString(),
    totalPredictions,
    wins,
    losses,
    accuracyPct: round(accuracyPct),
    netPnLPct: round(netPnLPct),
    feeRatePct,
    points,
    expertPerformance,
  };
}

export async function runMiniBacktest(params: {
  symbol: string;
  /** How many days of history to fetch for indicators (EMA200 needs ~34 days on 4h). */
  historyDays?: number;
  /** How many most-recent 4h candles to actually analyze with the Consensus Engine. */
  analyzeLastCandles?: number;
}): Promise<BacktestReport> {
  const historyDays = params.historyDays ?? 70;
  const analyzeLastCandles = Math.max(10, Math.min(40, params.analyzeLastCandles ?? 20));
  const nowMs = Date.now();
  const startTimeMs = nowMs - historyDays * 24 * 60 * 60 * 1000;

  const cleanSymbol = normalizeSymbol(params.symbol || '');
  if (!cleanSymbol) {
    const emptyStats: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
    return {
      symbol: params.symbol || '',
      startDate: new Date(startTimeMs).toISOString(),
      endDate: new Date(nowMs).toISOString(),
      totalPredictions: 0,
      wins: 0,
      losses: 0,
      accuracyPct: 0,
      netPnLPct: 0,
      feeRatePct: 0.2,
      points: [],
      expertPerformance: {
        technician: { ...emptyStats },
        risk: { ...emptyStats },
        psych: { ...emptyStats },
        macro: { ...emptyStats },
        onchain: { ...emptyStats },
        deepMemory: { ...emptyStats },
        bestExpertKey: null,
      },
    };
  }

  const klines = await fetch4hKlines(cleanSymbol, startTimeMs, nowMs);
  if (klines.length < 30) {
    throw new Error('Not enough 4h candles to run mini backtest.');
  }

  let oiRows: OpenInterestRow[] = [];
  try {
    oiRows = await fetchOpenInterest(cleanSymbol, startTimeMs, nowMs);
  } catch (oiErr) {
    console.warn('[Mini Backtest] Open Interest fetch failed, continuing without OI.', oiErr instanceof Error ? oiErr.message : String(oiErr));
  }

  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);

  const ema20Series = computeEmaSeries(closes, 20);
  const ema50Series = computeEmaSeries(closes, 50);
  const ema200Series = computeEmaSeries(closes, 200);
  const bb = computeBollingerSeries(closes, 20, 2);

  const rsiSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const window = closes.slice(0, i + 1);
    rsiSeries.push(computeRSI(window, 14));
  }

  const neutralConsensusFallback = (): ConsensusResult => ({
    tech_score: 50,
    risk_score: 50,
    psych_score: 50,
    macro_score: 50,
    onchain_score: 50,
    deep_memory_score: 50,
    tech_logic: 'Neutral expert fallback (backtest error).',
    risk_logic: 'Neutral expert fallback (backtest error).',
    psych_logic: 'Neutral expert fallback (backtest error).',
    macro_logic: 'Neutral expert fallback (backtest error).',
    onchain_logic: 'Neutral expert fallback (backtest error).',
    deep_memory_logic: 'Neutral expert fallback (backtest error).',
    master_insight_he: 'תובנת AI לא זמינה עבור נר זה — חוזה לנייטרלי בלבד.',
    reasoning_path: 'Mini backtest applied neutral fallback after AI pipeline error.',
    final_confidence: 50,
    consensus_approved: false,
  });

  const points: BacktestPoint[] = [];
  const analysisStartIdx = Math.max(0, klines.length - analyzeLastCandles);
  const batchSize = 5;
  let batchPromises: Promise<void>[] = [];

  const totalCandlesToAnalyze = klines.slice(analysisStartIdx).reduce((sum, _, idx) => {
    const absIdx = analysisStartIdx + idx;
    return sum + (Number.isFinite(rsiSeries[absIdx]) ? 1 : 0);
  }, 0);
  let processedCount = 0;

  const logProgress = () => {
    const pct = totalCandlesToAnalyze > 0 ? Math.round((processedCount / totalCandlesToAnalyze) * 100) : 0;
    process.stdout.write(
      `\r[Mini Backtest] ${cleanSymbol}: ${pct}% (${processedCount}/${totalCandlesToAnalyze})    `
    );
  };

  for (let i = analysisStartIdx; i < klines.length; i++) {
    const k = klines[i]!;
    const rsi14 = rsiSeries[i]!;
    if (!Number.isFinite(rsi14)) continue;

    const task = (async () => {
      const volatilityPct = k.close > 0 ? ((k.high - k.low) / k.close) * 100 : 0;

      const ema20 = ema20Series[i] ?? null;
      const ema50 = ema50Series[i] ?? null;
      const ema200 = ema200Series[i] ?? null;
      const marketStructure = inferMarketStructure({ highs, lows, idx: i, window: 20 });
      const bbMid = bb.mid[i] ?? null;
      const bbUpper = bb.upper[i] ?? null;
      const bbLower = bb.lower[i] ?? null;
      const bbPercentB = bb.percentB[i] ?? null;
      const oiEnrichment = getOIEnrichmentForCandle(k.openTime, klines, oiRows);
      const { technicalContextTextHe, assetMomentumTextHe } = buildTechnicalContext({
        idx: i,
        close: k.close,
        ema20,
        ema50,
        ema200,
        bbMid,
        bbUpper,
        bbLower,
        bbPercentB,
        marketStructure,
        oiStatus: oiEnrichment.oiStatus,
        oiChangePct: oiEnrichment.oiChangePct,
      });
      const openInterestSignal = formatOISignal(oiEnrichment);

      const hvn_levels: number[] = [];
      const nearest_sr_distance_pct: number | null = null;
      const volume_profile_summary = 'Mini backtest 4h — lightweight mode (no HVN profile).';

      let consensus: ConsensusResult;
      try {
        consensus = await runConsensusEngine(
          {
            symbol: cleanSymbol,
            current_price: k.close,
            rsi_14: rsi14,
            atr_value: null,
            atr_pct_of_price: null,
            macd_signal: null,
            volume_profile_summary,
            hvn_levels,
            nearest_sr_distance_pct,
            volatility_pct: volatilityPct,
            btc_trend: undefined,
            asset_momentum: assetMomentumTextHe,
            technical_context: technicalContextTextHe,
            open_interest_signal: openInterestSignal,
            funding_rate_signal: null,
            liquidity_sweep_context: null,
            onchain_metric_shift: null,
            social_dominance_volume: null,
            twitter_realtime_tweets: null,
            macro_context: null,
          },
          { moeConfidenceThreshold: undefined }
        );
      } catch (err) {
        console.warn('[Mini Backtest] Consensus failed, using neutral fallback.', {
          symbol: cleanSymbol,
          openTime: k.openTime,
          error: err instanceof Error ? err.message : String(err),
        });
        consensus = neutralConsensusFallback();
      }

      const direction = inferDirection(rsi14, consensus);
      const confidence = consensus.final_confidence;
      const futureIdx = i + 6;
      const future = futureIdx < klines.length ? klines[futureIdx] : undefined;
      const futureMovePct24h =
        future && k.close > 0 ? ((future.close - k.close) / k.close) * 100 : null;
      const outcome = classifyOutcome(direction, futureMovePct24h);

      points.push({
        openTime: k.openTime,
        closeTime: k.openTime + 4 * 60 * 60 * 1000,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        rsi14,
        volatilityPct,
        consensus,
        direction,
        confidence,
        futureCloseTime: future?.openTime,
        futureClosePrice: future?.close,
        futureMovePct24h,
        outcome,
      });
    })();

    batchPromises.push(task);
    if (batchPromises.length === batchSize) {
      await Promise.all(batchPromises);
      processedCount += batchPromises.length;
      logProgress();
      batchPromises = [];
      await sleep(1500);
    }
  }

  if (batchPromises.length > 0) {
    await Promise.all(batchPromises);
    processedCount += batchPromises.length;
    logProgress();
  }
  process.stdout.write('\n');

  points.sort((a, b) => a.openTime - b.openTime);
  const actionable = points.filter((p) => p.outcome !== 'SKIP');
  const wins = actionable.filter((p) => p.outcome === 'WIN').length;
  const losses = actionable.filter((p) => p.outcome === 'LOSS').length;
  const totalPredictions = actionable.length;
  const accuracyPct = totalPredictions > 0 ? (wins / totalPredictions) * 100 : 0;

  const feeRatePct = 0.2;
  const round = (v: number) => Math.round(v * 100) / 100;
  let netPnLPct = 0;
  for (const p of actionable) {
    if (p.futureMovePct24h == null) continue;
    const grossMove =
      p.direction === 'Bullish'
        ? p.futureMovePct24h
        : p.direction === 'Bearish'
          ? -p.futureMovePct24h
          : 0;
    const totalFees = 2 * feeRatePct;
    netPnLPct += grossMove - totalFees;
  }

  const tech: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const risk: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const psych: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const macro: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const onchain: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  const deepMemory: ExpertStats = { wins: 0, losses: 0, total: 0, accuracyPct: 0 };
  for (const p of actionable) {
    if (p.futureMovePct24h == null) continue;
    const move = p.futureMovePct24h;
    updateExpertStats(tech, p.consensus.tech_score, move);
    updateExpertStats(risk, p.consensus.risk_score, move);
    updateExpertStats(psych, p.consensus.psych_score, move);
    updateExpertStats(macro, p.consensus.macro_score, move);
    updateExpertStats(onchain, p.consensus.onchain_score, move);
    updateExpertStats(deepMemory, p.consensus.deep_memory_score, move);
  }

  const expertPerformance = {
    technician: finalizeExpertStats(tech),
    risk: finalizeExpertStats(risk),
    psych: finalizeExpertStats(psych),
    macro: finalizeExpertStats(macro),
    onchain: finalizeExpertStats(onchain),
    deepMemory: finalizeExpertStats(deepMemory),
    bestExpertKey: null as keyof BacktestReport['expertPerformance'] | null,
  };
  let bestKey: keyof typeof expertPerformance | null = null;
  let bestAcc = -1;
  (Object.keys(expertPerformance) as (keyof typeof expertPerformance)[]).forEach((k) => {
    if (k === 'bestExpertKey') return;
    const acc = expertPerformance[k].accuracyPct;
    if (acc > bestAcc && expertPerformance[k].total > 0) {
      bestAcc = acc;
      bestKey = k;
    }
  });
  expertPerformance.bestExpertKey = bestKey;

  return {
    symbol: cleanSymbol,
    startDate: new Date(startTimeMs).toISOString(),
    endDate: new Date(nowMs).toISOString(),
    totalPredictions,
    wins,
    losses,
    accuracyPct: round(accuracyPct),
    netPnLPct: round(netPnLPct),
    feeRatePct,
    points,
    expertPerformance,
  };
}

export function performanceTierFromAccuracy(accuracyPct: number): 'Elite' | 'Strong' | 'Average' | 'Learning' {
  if (!Number.isFinite(accuracyPct)) return 'Learning';
  if (accuracyPct >= 75) return 'Elite';
  if (accuracyPct >= 60) return 'Strong';
  if (accuracyPct >= 50) return 'Average';
  return 'Learning';
}

function expertLabelHe(key: keyof BacktestReport['expertPerformance']): string {
  switch (key) {
    case 'technician':
      return 'טכני';
    case 'macro':
      return 'מקרו';
    case 'risk':
      return 'סיכונים';
    case 'psych':
      return 'פסיכולוג שוק';
    case 'onchain':
      return 'On-Chain';
    case 'deepMemory':
      return 'Deep Memory';
    default:
      return String(key);
  }
}

function directionLabelHe(d: Direction): string {
  if (d === 'Bullish') return 'בוליש';
  if (d === 'Bearish') return 'בריש';
  return 'נייטרלי';
}

export function generateBacktestSummary(reports: BacktestReport[]): string {
  const RTL_MARK = '\u200F';
  const safeReports = Array.isArray(reports) ? reports.filter(Boolean) : [];
  if (safeReports.length === 0) {
    return `${RTL_MARK}🧾 <b>סיכום Backtest</b>\n\nאין נתונים לחישוב סיכום.`;
  }

  const top = safeReports.reduce((best, r) => (r.accuracyPct > best.accuracyPct ? r : best), safeReports[0]!);
  const tier = performanceTierFromAccuracy(top.accuracyPct);

  // Aggregate expert "alpha" across symbols: weighted by number of expert samples.
  type ExpertPerformanceKey = Exclude<keyof BacktestReport['expertPerformance'], 'bestExpertKey'>;
  const expertKeys: ExpertPerformanceKey[] = [
    'technician',
    'risk',
    'psych',
    'macro',
    'onchain',
    'deepMemory',
  ];
  const expertAgg = new Map<
    ExpertPerformanceKey,
    { total: number; weightedAccSum: number }
  >();
  for (const k of expertKeys) {
    expertAgg.set(k, { total: 0, weightedAccSum: 0 });
  }
  for (const r of safeReports) {
    for (const k of expertKeys) {
      const s = r.expertPerformance[k];
      const entry = expertAgg.get(k)!;
      entry.total += s.total;
      entry.weightedAccSum += s.accuracyPct * s.total;
    }
  }
  let alphaKey: ExpertPerformanceKey = 'technician';
  let alphaAcc = -1;
  for (const k of expertKeys) {
    const e = expertAgg.get(k)!;
    if (e.total <= 0) continue;
    const avg = e.weightedAccSum / e.total;
    if (avg > alphaAcc) {
      alphaAcc = avg;
      alphaKey = k;
    }
  }

  // Market sentiment: weighted by confidence, across all points (ignore Neutral).
  let bullW = 0;
  let bearW = 0;
  for (const r of safeReports) {
    for (const p of r.points) {
      if (p.direction === 'Bullish') bullW += Math.max(0, p.confidence || 0);
      if (p.direction === 'Bearish') bearW += Math.max(0, p.confidence || 0);
    }
  }
  const totalW = bullW + bearW;
  const sentimentScore = totalW > 0 ? ((bullW - bearW) / totalW) * 100 : 0; // -100..100
  const sentimentHe =
    sentimentScore >= 25 ? 'דומיננטיות בוליש' : sentimentScore <= -25 ? 'דומיננטיות בריש' : 'מעורב / ניטרלי';

  const tip =
    sentimentScore >= 25
      ? `השוק מציג נטייה בולישית, והמומחה ${expertLabelHe(alphaKey)} הוא המדויק ביותר — מומלץ לתת לו משקל גבוה יותר בהחלטות.`
      : sentimentScore <= -25
        ? `השוק מציג נטייה ברישית, והמומחה ${expertLabelHe(alphaKey)} הוא המדויק ביותר — מומלץ לתת לו משקל גבוה יותר בהחלטות.`
        : `השוק במבנה מעורב, והמומחה ${expertLabelHe(alphaKey)} הוא המדויק ביותר — מומלץ להישאר סלקטיביים ולהקשיח סף ביטחון.`;

  const lines: string[] = [];
  lines.push(`${RTL_MARK}🧾 <b>סיכום Backtest — תובנות הנהלה</b>`);
  lines.push('');
  lines.push(`🏆 <b>Top Performer:</b> ${top.symbol.replace('USDT', '')} | דיוק ${top.accuracyPct}% | Tier: <b>${tier}</b>`);
  lines.push(`🧠 <b>Alpha Expert:</b> ${expertLabelHe(alphaKey)}${alphaAcc >= 0 ? ` (דיוק משוקלל ${round2(alphaAcc)}%)` : ''}`);
  const scoreStr =
    sentimentScore > 0 ? `+${round2(sentimentScore)}` : `${round2(sentimentScore)}`;
  lines.push(`📊 <b>סנטימנט שוק:</b> ${sentimentHe} | ציון משוקלל: ${scoreStr}`);
  lines.push('');
  lines.push(`✅ <b>טיפ פעולה:</b> ${tip}`);
  lines.push('');
  lines.push(
    `📌 <b>כיוונים חזויים (Top):</b> ${directionLabelHe(top.points.at(-1)?.direction ?? 'Neutral')}`
  );

  return lines.join('\n');
}

