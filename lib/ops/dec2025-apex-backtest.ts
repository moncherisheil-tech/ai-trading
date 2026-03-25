/**
 * OPERATION APEX — Dec 2025 quantum backtest: OHLCV + RSI + MACD, simulated perps OI/funding,
 * full runConsensusEngine per candle, PnL with 0.1% slippage per side, max drawdown + Sharpe.
 */

import { computeRSI } from '@/lib/prediction-formula';
import { runConsensusEngine, computeMacdSignal, sleep, type ConsensusResult } from '@/lib/consensus-engine';
import {
  computeEmaSeries,
  computeBollingerSeries,
  inferMarketStructure,
  buildTechnicalContext,
} from '@/lib/quant/technical-context';
import { fetch4hKlines, type BacktestPoint } from '@/lib/ops/backtest-engine';

const SLIPPAGE_PCT_PER_SIDE = 0.1;
const DEC_2025_START = '2025-12-01T00:00:00.000Z';
const DEC_2025_END = '2025-12-31T23:59:59.999Z';

type Direction = 'Bullish' | 'Bearish' | 'Neutral';

function normalizeSymbol(symbol: string): string | null {
  const s = (symbol || '').trim().toUpperCase();
  if (!s || s === 'USDT') return null;
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

function inferDirection(_rsi14: number, consensus: ConsensusResult): Direction {
  const gem = consensus.final_confidence;
  if (!Number.isFinite(gem)) return 'Neutral';
  if (gem >= 55) return 'Bullish';
  if (gem <= 45) return 'Bearish';
  return 'Neutral';
}

function classifyOutcome(direction: Direction, movePct: number | null | undefined): 'WIN' | 'LOSS' | 'SKIP' {
  if (movePct == null || !Number.isFinite(movePct)) return 'SKIP';
  if (direction === 'Neutral') return 'SKIP';
  if (direction === 'Bullish') return movePct > 0 ? 'WIN' : 'LOSS';
  if (direction === 'Bearish') return movePct < 0 ? 'WIN' : 'LOSS';
  return 'SKIP';
}

/** Deterministic simulated futures OI / funding (no external perps API). */
function simulatedDerivativesContext(i: number, close: number, volume: number): {
  openInterestSignal: string;
  fundingRateSignal: string;
  orderBookSummary: string;
} {
  const oiDeltaPct = Math.sin(i / 2.7) * 4.2 + Math.cos(i / 4.1) * 1.8;
  const oiLevel = close * volume * (1 + 0.012 * Math.sin(i / 3));
  const funding8h = Math.cos(i / 2.2) * 0.018 + Math.sin(i / 5) * 0.006;
  const wallBid = close * (1 - 0.0012 - (i % 7) * 0.00005);
  const wallAsk = close * (1 + 0.0015 + (i % 5) * 0.00004);
  return {
    openInterestSignal: `SIM_DEC2025: OI level ~${oiLevel.toFixed(0)} (proxy), ΔOI ${oiDeltaPct.toFixed(2)}% vs prior 4h; participation ${oiDeltaPct > 1 ? 'rising' : oiDeltaPct < -1 ? 'falling' : 'flat'}.`,
    fundingRateSignal: `SIM_DEC2025: 8h funding ${(funding8h * 100).toFixed(4)}% (synthetic); perp basis neutral-to-${funding8h > 0 ? 'premium' : 'discount'}.`,
    orderBookSummary: `SIM_DEPTH: bid wall ${wallBid.toFixed(2)} / ask wall ${wallAsk.toFixed(2)}; imbalance oscillating — use spoofing rules in Macro/Psych.`,
  };
}

function neutralConsensusFallback(): ConsensusResult {
  return {
    tech_score: 50,
    risk_score: 50,
    psych_score: 50,
    macro_score: 50,
    onchain_score: 50,
    deep_memory_score: 50,
    tech_logic: 'Neutral fallback (Dec2025 apex).',
    risk_logic: 'Neutral fallback (Dec2025 apex).',
    psych_logic: 'Neutral fallback (Dec2025 apex).',
    macro_logic: 'Neutral fallback (Dec2025 apex).',
    onchain_logic: 'Neutral fallback (Dec2025 apex).',
    deep_memory_logic: 'Neutral fallback (Dec2025 apex).',
    master_insight_he: 'נייטרלי — שגיאת מנוע.',
    reasoning_path: 'Dec2025 apex neutral fallback.',
    final_confidence: 50,
    consensus_approved: false,
  };
}

export interface Dec2025ApexResult {
  symbol: string;
  window: { start: string; end: string };
  slippagePctPerSide: number;
  totalPredictions: number;
  wins: number;
  losses: number;
  accuracyPct: number;
  simulatedPnLPercent: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  pointsAnalyzed: number;
  /** Summary row per candle (consensus embedded). */
  points: BacktestPoint[];
}

export async function runDec2025QuantumBacktest(
  symbol: string,
  options?: { maxConsensusCandles?: number }
): Promise<Dec2025ApexResult> {
  const cleanSymbol = normalizeSymbol(symbol);
  if (!cleanSymbol) {
    throw new Error('Invalid symbol for Dec 2025 apex backtest.');
  }
  const startTimeMs = new Date(DEC_2025_START).getTime();
  const endTimeMs = new Date(DEC_2025_END).getTime();
  const warmupMs = 210 * 4 * 60 * 60 * 1000;

  const klines = await fetch4hKlines(cleanSymbol, startTimeMs - warmupMs, endTimeMs);
  const decStartIdx = klines.findIndex((k) => k.openTime >= startTimeMs);
  if (decStartIdx < 0) {
    throw new Error('Not enough 4h candles: no bar on/after Dec 2025 start.');
  }
  let decEndIdx = decStartIdx;
  for (let k = decStartIdx; k < klines.length; k++) {
    if (klines[k]!.openTime <= endTimeMs) decEndIdx = k + 1;
    else break;
  }
  const maxC = options?.maxConsensusCandles;
  const loopEnd = maxC != null ? Math.min(decStartIdx + Math.max(1, maxC), decEndIdx) : decEndIdx;
  if (loopEnd - decStartIdx < 1) {
    throw new Error('Not enough December 4h candles in window.');
  }
  if (decStartIdx < 200) {
    throw new Error('Warmup history too short for stable EMA200/RSI on first December candle.');
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
    rsiSeries.push(computeRSI(closes.slice(0, i + 1), 14));
  }

  const points: BacktestPoint[] = [];
  const batchSize = 4;
  let batch: Promise<void>[] = [];

  for (let i = decStartIdx; i < loopEnd; i++) {
    const k = klines[i]!;
    const rsi14 = rsiSeries[i]!;
    if (!Number.isFinite(rsi14)) continue;

    const task = (async () => {
      const volatilityPct = k.close > 0 ? ((k.high - k.low) / k.close) * 100 : 0;
      const macdSlice = closes.slice(0, i + 1);
      const macd_signal = computeMacdSignal(macdSlice);

      const ema20 = ema20Series[i] ?? null;
      const ema50 = ema50Series[i] ?? null;
      const ema200 = ema200Series[i] ?? null;
      const marketStructure = inferMarketStructure({ highs, lows, idx: i, window: 20 });
      const bbMid = bb.mid[i] ?? null;
      const bbUpper = bb.upper[i] ?? null;
      const bbLower = bb.lower[i] ?? null;
      const bbPercentB = bb.percentB[i] ?? null;

      const oiChg = Math.sin(i / 2.7) * 4;
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
        oiStatus: oiChg > 1 ? 'Rising' : oiChg < -1 ? 'Falling' : 'Stable',
        oiChangePct: oiChg,
      });

      const sim = simulatedDerivativesContext(i, k.close, k.volume);

      let consensus: ConsensusResult;
      try {
        consensus = await runConsensusEngine(
          {
            symbol: cleanSymbol,
            current_price: k.close,
            rsi_14: rsi14,
            atr_value: null,
            atr_pct_of_price: null,
            macd_signal,
            volume_profile_summary: 'Dec2025 4h apex — volume from OHLCV only.',
            hvn_levels: [],
            nearest_sr_distance_pct: null,
            volatility_pct: volatilityPct,
            asset_momentum: assetMomentumTextHe,
            technical_context: technicalContextTextHe,
            open_interest_signal: sim.openInterestSignal,
            funding_rate_signal: sim.fundingRateSignal,
            liquidity_sweep_context: null,
            onchain_metric_shift: null,
            social_dominance_volume: null,
            twitter_realtime_tweets: null,
            macro_context: null,
            order_book_summary: sim.orderBookSummary,
          },
          { moeConfidenceThreshold: undefined }
        );
      } catch {
        consensus = neutralConsensusFallback();
      }

      const direction = inferDirection(rsi14, consensus);
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
        confidence: consensus.final_confidence,
        futureCloseTime: future?.openTime,
        futureClosePrice: future?.close,
        futureMovePct24h,
        outcome,
      });
    })();

    batch.push(task);
    if (batch.length >= batchSize) {
      await Promise.all(batch);
      batch = [];
      await sleep(1200);
    }
  }
  if (batch.length) await Promise.all(batch);

  points.sort((a, b) => a.openTime - b.openTime);

  const actionable = points.filter((p) => p.outcome !== 'SKIP');
  const wins = actionable.filter((p) => p.outcome === 'WIN').length;
  const losses = actionable.filter((p) => p.outcome === 'LOSS').length;
  const totalPredictions = actionable.length;
  const accuracyPct = totalPredictions > 0 ? Math.round((wins / totalPredictions) * 1000) / 10 : 0;

  const roundTripSlippage = 2 * SLIPPAGE_PCT_PER_SIDE;
  const perTradeReturns: number[] = [];
  let simulatedPnLPercent = 0;

  for (const p of actionable) {
    if (p.futureMovePct24h == null) continue;
    const grossMove =
      p.direction === 'Bullish'
        ? p.futureMovePct24h
        : p.direction === 'Bearish'
          ? -p.futureMovePct24h
          : 0;
    const netMove = grossMove - roundTripSlippage;
    perTradeReturns.push(netMove);
    simulatedPnLPercent += netMove;
  }
  simulatedPnLPercent = Math.round(simulatedPnLPercent * 100) / 100;

  let peak = 0;
  let equity = 0;
  let maxDrawdownPercent = 0;
  for (const r of perTradeReturns) {
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdownPercent) maxDrawdownPercent = dd;
  }
  maxDrawdownPercent = Math.round(maxDrawdownPercent * 100) / 100;

  const n = perTradeReturns.length;
  const mean = n > 0 ? perTradeReturns.reduce((a, b) => a + b, 0) / n : 0;
  const variance =
    n > 1 ? perTradeReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  /** ~6 four-hour bars per day, 252 trading days. */
  const periodsPerYear = 6 * 252;
  const sharpeRatio =
    std > 1e-9 && Number.isFinite(mean) ? Math.round((mean / std) * Math.sqrt(periodsPerYear) * 1000) / 1000 : 0;

  return {
    symbol: cleanSymbol,
    window: { start: DEC_2025_START, end: DEC_2025_END },
    slippagePctPerSide: SLIPPAGE_PCT_PER_SIDE,
    totalPredictions,
    wins,
    losses,
    accuracyPct,
    simulatedPnLPercent,
    maxDrawdownPercent,
    sharpeRatio,
    pointsAnalyzed: points.length,
    points,
  };
}
