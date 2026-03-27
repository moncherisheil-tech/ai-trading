import { APP_CONFIG } from '@/lib/config';
import { fetchWithBackoff, fetchMacroContext } from '@/lib/api-utils';
import { atr, rsi } from '@/lib/indicators';
import { runConsensusEngine } from '@/lib/consensus-engine';
import type { ConsensusResult } from '@/lib/consensus-engine';

export type AdvisorySignal = 'BUY' | 'SELL' | 'HOLD';
export type ForecastTimeframe = '⚡ FLASH' | '1-4 Hours' | '1-3 Days';

export interface AssetOutlook {
  signal: AdvisorySignal;
  probability: number;
  timeframe: ForecastTimeframe;
  rationale: string;
}

export interface AssetForecast {
  asset: string;
  flashOutlook?: AssetOutlook;
  shortTermOutlook: AssetOutlook;
  swingOutlook: AssetOutlook;
  hawkEye?: {
    liquidityGapDetected: boolean;
    highVelocityPriority: boolean;
    gapStrengthPct: number;
  };
}

export interface ForecastEngineOptions {
  useLiveAnalysis?: boolean;
}

const TOP_ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'] as const;

type KlineTuple = [number, string, string, string, string, string];

function clampProbability(value: number): number {
  return Math.max(50, Math.min(99, Math.round(value)));
}

function toAdvisorySignal(score: number, gate = 4): AdvisorySignal {
  if (score >= gate) return 'BUY';
  if (score <= -gate) return 'SELL';
  return 'HOLD';
}

function buildRationale(parts: string[]): string {
  return parts.filter(Boolean).slice(0, 2).join(' ');
}

function normalizeAsset(symbol: string): string {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}

function detectLiquidityGap(closes: number[]): { detected: boolean; strengthPct: number } {
  if (closes.length < 8) return { detected: false, strengthPct: 0 };
  const last = closes[closes.length - 1]!;
  const prev = closes[closes.length - 2]!;
  const baseline = closes.slice(-7, -2);
  const avg = baseline.reduce((a, b) => a + b, 0) / Math.max(1, baseline.length);
  const stepPct = prev > 0 ? Math.abs(((last - prev) / prev) * 100) : 0;
  const baselinePct = avg > 0 ? Math.abs(((last - avg) / avg) * 100) : 0;
  const strength = Math.max(stepPct, baselinePct);
  return { detected: strength >= 1.1, strengthPct: Math.round(strength * 100) / 100 };
}

function hasFallbackConsensus(consensus: ConsensusResult): boolean {
  if (consensus.macro_fallback_used || consensus.onchain_fallback_used || consensus.deep_memory_fallback_used) {
    return true;
  }
  const rationaleText = [
    consensus.tech_logic,
    consensus.risk_logic,
    consensus.psych_logic,
    consensus.macro_logic,
    consensus.onchain_logic,
    consensus.deep_memory_logic,
    consensus.master_insight_he,
  ]
    .join(' ')
    .toLowerCase();
  return (
    rationaleText.includes('timeout') ||
    rationaleText.includes('שגיאה') ||
    rationaleText.includes('לא זמין') ||
    rationaleText.includes('אין מספיק נתוני deep memory')
  );
}

async function fetchKlines(symbol: string, interval: '1h' | '4h', limit: number): Promise<KlineTuple[]> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const response = await fetchWithBackoff(url, { timeoutMs: 12_000, maxRetries: 2, cache: 'no-store' });
  if (!response.ok) return [];
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) return [];
  return payload.filter((row): row is KlineTuple => Array.isArray(row) && row.length >= 6);
}

async function buildLiveForecastForAsset(symbol: string): Promise<AssetForecast | null> {
  const [klines1h, klines4h, macro] = await Promise.all([
    fetchKlines(symbol, '1h', 120),
    fetchKlines(symbol, '4h', 120),
    fetchMacroContext(),
  ]);

  if (klines1h.length < 40 || klines4h.length < 40) return null;

  const closes1h = klines1h.map((k) => Number.parseFloat(k[4]));
  const highs1h = klines1h.map((k) => Number.parseFloat(k[2]));
  const lows1h = klines1h.map((k) => Number.parseFloat(k[3]));

  const closes4h = klines4h.map((k) => Number.parseFloat(k[4]));
  const highs4h = klines4h.map((k) => Number.parseFloat(k[2]));
  const lows4h = klines4h.map((k) => Number.parseFloat(k[3]));

  const currentPrice = closes1h[closes1h.length - 1];
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const rsi1h = rsi(closes1h, 14);
  const atr1h = atr(highs1h, lows1h, closes1h, 14);
  const atrPct = atr1h != null ? (atr1h / currentPrice) * 100 : null;
  const liquidityGap = detectLiquidityGap(closes1h);

  const consensus = await runConsensusEngine(
    {
      symbol,
      current_price: currentPrice,
      rsi_14: Number.isFinite(rsi1h) ? rsi1h : 50,
      atr_value: atr1h,
      atr_pct_of_price: atrPct,
      macd_signal: null,
      volume_profile_summary: 'Forecast engine summary with intraday and swing context.',
      hvn_levels: [],
      nearest_sr_distance_pct: null,
      volatility_pct: Math.max(0.1, atrPct ?? 1.5),
      btc_trend: 'neutral',
      asset_momentum: 'Timeframe momentum comparison (1h vs 4h).',
      technical_context: 'Short and swing context synthesized from live klines.',
      open_interest_signal: null,
      macro_context: `DXY: ${macro.dxyNote}`,
      order_book_summary: `BTC dominance ${macro.btcDominancePct ?? 'N/A'}%, fear/greed ${macro.fearGreedIndex ?? 'N/A'}.`,
    },
    { timeoutMs: 55_000 }
  );

  if (!consensus.consensus_approved || hasFallbackConsensus(consensus)) {
    // Keep Hawk-Eye stream live with deterministic local fallback instead of dropping the card.
    const fallbackBias = (Number.isFinite(rsi1h) ? (50 - rsi1h) : 0) + (liquidityGap.detected ? 6 : 0);
    const fallbackFlashSignal = toAdvisorySignal(fallbackBias, 2);
    const fallbackFlashProbability = clampProbability(Math.abs(fallbackBias) + 58 + (liquidityGap.detected ? 8 : 0));
    const fallbackShortSignal = toAdvisorySignal(fallbackBias, 4);
    const fallbackShortProbability = clampProbability(Math.abs(fallbackBias) + 55);
    const fallbackSwingSignal = 'HOLD' as AdvisorySignal;
    return {
      asset: normalizeAsset(symbol),
      hawkEye: {
        liquidityGapDetected: liquidityGap.detected,
        highVelocityPriority: liquidityGap.detected && fallbackFlashProbability >= 80 && fallbackFlashSignal !== 'HOLD',
        gapStrengthPct: liquidityGap.strengthPct,
      },
      flashOutlook: {
        signal: fallbackFlashSignal,
        probability: fallbackFlashProbability,
        timeframe: '⚡ FLASH',
        rationale: liquidityGap.detected
          ? `Hawk-Eye liquidity gap detected (${liquidityGap.strengthPct}%). Local fallback stream active.`
          : 'Local fallback stream active while board consensus is recalibrating.',
      },
      shortTermOutlook: {
        signal: fallbackShortSignal,
        probability: fallbackShortProbability,
        timeframe: '1-4 Hours',
        rationale: 'Fallback projection based on intraday momentum proxy.',
      },
      swingOutlook: {
        signal: fallbackSwingSignal,
        probability: 56,
        timeframe: '1-3 Days',
        rationale: 'Awaiting full board consensus for swing horizon.',
      },
    };
  }

  const shortBias = consensus.tech_score * 0.45 + consensus.psych_score * 0.25 + consensus.onchain_score * 0.3 - 50;
  const swingBias = consensus.macro_score * 0.35 + consensus.risk_score * 0.25 + consensus.deep_memory_score * 0.4 - 50;
  const flashBias = consensus.tech_score * 0.42 + consensus.onchain_score * 0.38 + consensus.psych_score * 0.2 - 50;
  const shortSignal = toAdvisorySignal(shortBias);
  const swingSignal = toAdvisorySignal(swingBias);
  const flashSignal = toAdvisorySignal(flashBias, 3);
  const shortProbability = clampProbability(Math.abs(shortBias) + 60);
  const swingProbability = clampProbability(Math.abs(swingBias) + 58);
  const flashProbability = clampProbability(
    Math.abs(flashBias) +
      64 +
      (consensus.final_confidence >= 80 ? 3 : 0) +
      (liquidityGap.detected ? Math.min(8, Math.round(liquidityGap.strengthPct)) : 0)
  );

  return {
    asset: normalizeAsset(symbol),
    hawkEye: {
      liquidityGapDetected: liquidityGap.detected,
      highVelocityPriority:
        liquidityGap.detected && flashProbability >= 84 && flashSignal !== 'HOLD' && consensus.consensus_approved,
      gapStrengthPct: liquidityGap.strengthPct,
    },
    flashOutlook: {
      signal: flashSignal,
      probability: flashProbability,
      timeframe: '⚡ FLASH',
      rationale: buildRationale([
        liquidityGap.detected
          ? `Hawk-Eye liquidity gap ${liquidityGap.strengthPct}% synchronized with FLASH lane.`
          : '',
        consensus.onchain_logic,
        consensus.tech_logic,
      ]),
    },
    shortTermOutlook: {
      signal: shortSignal,
      probability: shortProbability,
      timeframe: '1-4 Hours',
      rationale: buildRationale([consensus.tech_logic, consensus.psych_logic]),
    },
    swingOutlook: {
      signal: swingSignal,
      probability: swingProbability,
      timeframe: '1-3 Days',
      rationale: buildRationale([consensus.master_insight_he, consensus.deep_memory_logic]),
    },
  };
}

export async function getAlphaSignalForecasts(options: ForecastEngineOptions = {}): Promise<AssetForecast[]> {
  if (!options.useLiveAnalysis) return [];

  const liveResults = await Promise.all(TOP_ASSETS.map((symbol) => buildLiveForecastForAsset(symbol).catch(() => null)));
  const valid = liveResults.filter((item): item is AssetForecast => item != null);
  return valid;
}
