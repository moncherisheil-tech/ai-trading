/**
 * LIVE ALPHA — first N 4h candles of Dec 2025 (BTC/USDT default): real runConsensusEngine (Gemini + Groq),
 * verdict vs next-candle close-to-close move. No mockPayload.
 */

import { computeRSI } from '@/lib/prediction-formula';
import { runConsensusEngine, computeMacdSignal, sleep, type ConsensusResult } from '@/lib/consensus-engine';
import {
  computeEmaSeries,
  computeBollingerSeries,
  inferMarketStructure,
  buildTechnicalContext,
} from '@/lib/quant/technical-context';
import { fetch4hKlines } from '@/lib/ops/backtest-engine';

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

export interface LiveAlpha5CandleRow {
  candleIndex: number;
  openTimeIso: string;
  close: number;
  rsi14: number;
  volatilityPct: number;
  direction: Direction;
  finalConfidence: number;
  consensusApproved: boolean;
  masterInsightHe: string;
  nextClose: number | null;
  /** Close-to-close % move into the next 4h candle (reality check). */
  actualMovePctNext: number | null;
  outcome: 'WIN' | 'LOSS' | 'SKIP';
}

export interface LiveAlpha5CandleResult {
  symbol: string;
  window: { start: string; end: string };
  candleCount: number;
  rows: LiveAlpha5CandleRow[];
  wins: number;
  losses: number;
  skipped: number;
  accuracyPct: number;
}

/**
 * Runs real consensus on the first `candleCount` Dec 2025 4h candles; compares verdict to **next** candle move.
 * Requires GEMINI / GROQ keys and network. Sequential calls with pacing to reduce rate limits.
 */
export async function runLiveAlphaFirstCandlesDec2025(
  symbol = 'BTCUSDT',
  candleCount = 5
): Promise<LiveAlpha5CandleResult> {
  const cleanSymbol = normalizeSymbol(symbol);
  if (!cleanSymbol) {
    throw new Error('Invalid symbol for live alpha.');
  }
  const n = Math.max(1, Math.min(50, Math.floor(candleCount)));
  const startTimeMs = new Date(DEC_2025_START).getTime();
  const endTimeMs = new Date(DEC_2025_END).getTime();
  /** ~35 days of 4h bars before Dec 1 so EMA200 / RSI are meaningful on the first December candle. */
  const warmupMs = 210 * 4 * 60 * 60 * 1000;

  const klines = await fetch4hKlines(cleanSymbol, startTimeMs - warmupMs, endTimeMs);
  const decStartIdx = klines.findIndex((k) => k.openTime >= startTimeMs);
  if (decStartIdx < 0) {
    throw new Error('No 4h candles found on/after 2025-12-01 in fetched range.');
  }
  if (klines.length < decStartIdx + n + 1) {
    throw new Error(
      `Need at least ${n + 1} December 4h candles (incl. next bar for reality check); available from Dec start: ${klines.length - decStartIdx}.`
    );
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

  const rows: LiveAlpha5CandleRow[] = [];

  for (let j = 0; j < n; j++) {
    const i = decStartIdx + j;
    const k = klines[i]!;
    const rsi14 = rsiSeries[i]!;
    if (!Number.isFinite(rsi14)) continue;

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

    const consensus = await runConsensusEngine(
      {
        symbol: cleanSymbol,
        current_price: k.close,
        rsi_14: rsi14,
        atr_value: null,
        atr_pct_of_price: null,
        macd_signal,
        volume_profile_summary: 'Live Alpha Dec2025 4h — OHLCV only.',
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

    const direction = inferDirection(rsi14, consensus);
    const next = klines[i + 1];
    const actualMovePctNext =
      next && k.close > 0 ? ((next.close - k.close) / k.close) * 100 : null;
    const outcome = classifyOutcome(direction, actualMovePctNext);

    rows.push({
      candleIndex: j,
      openTimeIso: new Date(k.openTime).toISOString(),
      close: k.close,
      rsi14,
      volatilityPct,
      direction,
      finalConfidence: consensus.final_confidence,
      consensusApproved: Boolean(consensus.consensus_approved),
      masterInsightHe: String(consensus.master_insight_he || '').slice(0, 280),
      nextClose: next ? next.close : null,
      actualMovePctNext,
      outcome,
    });

    /** Pacing between candles — consensus fires many Gemini calls; free tier can hit daily RPM limits on long runs. */
    await sleep(2500);
  }

  const actionable = rows.filter((r) => r.outcome !== 'SKIP');
  const wins = actionable.filter((r) => r.outcome === 'WIN').length;
  const losses = actionable.filter((r) => r.outcome === 'LOSS').length;
  const skipped = rows.filter((r) => r.outcome === 'SKIP').length;
  const accuracyPct =
    actionable.length > 0 ? Math.round((wins / actionable.length) * 1000) / 10 : 0;

  return {
    symbol: cleanSymbol,
    window: { start: DEC_2025_START, end: DEC_2025_END },
    candleCount: n,
    rows,
    wins,
    losses,
    skipped,
    accuracyPct,
  };
}
