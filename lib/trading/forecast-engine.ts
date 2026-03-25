import { APP_CONFIG } from '@/lib/config';
import { fetchWithBackoff, fetchMacroContext } from '@/lib/api-utils';
import { atr, rsi } from '@/lib/indicators';
import { runConsensusEngine } from '@/lib/consensus-engine';

export type AdvisorySignal = 'BUY' | 'SELL' | 'HOLD';
export type ForecastTimeframe = '1-4 Hours' | '1-3 Days';

export interface AssetOutlook {
  signal: AdvisorySignal;
  probability: number;
  timeframe: ForecastTimeframe;
  rationale: string;
}

export interface AssetForecast {
  asset: string;
  shortTermOutlook: AssetOutlook;
  swingOutlook: AssetOutlook;
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

function getMockForecasts(): AssetForecast[] {
  return [
    {
      asset: 'BTC',
      shortTermOutlook: {
        signal: 'BUY',
        probability: 88,
        timeframe: '1-4 Hours',
        rationale:
          'Order-flow shows persistent bid absorption near support, while momentum remains constructive for a continuation push.',
      },
      swingOutlook: {
        signal: 'BUY',
        probability: 82,
        timeframe: '1-3 Days',
        rationale:
          'Macro risk is stable and the multi-day structure is still making higher lows, favoring controlled upside follow-through.',
      },
    },
    {
      asset: 'ETH',
      shortTermOutlook: {
        signal: 'HOLD',
        probability: 67,
        timeframe: '1-4 Hours',
        rationale:
          'Price is coiling inside a narrow range and mixed participation suggests waiting for a cleaner directional break.',
      },
      swingOutlook: {
        signal: 'BUY',
        probability: 74,
        timeframe: '1-3 Days',
        rationale:
          'Trend bias is still constructive, with supportive positioning metrics indicating upside potential if resistance clears.',
      },
    },
    {
      asset: 'SOL',
      shortTermOutlook: {
        signal: 'SELL',
        probability: 79,
        timeframe: '1-4 Hours',
        rationale:
          'Recent rejection into overhead liquidity and fading short-term breadth increase downside retracement risk.',
      },
      swingOutlook: {
        signal: 'HOLD',
        probability: 64,
        timeframe: '1-3 Days',
        rationale:
          'High volatility keeps direction less certain, so preserving optionality is preferred until trend confirmation returns.',
      },
    },
    {
      asset: 'XRP',
      shortTermOutlook: {
        signal: 'HOLD',
        probability: 62,
        timeframe: '1-4 Hours',
        rationale:
          'Flow is balanced between buyers and sellers, with no strong edge emerging from the immediate setup.',
      },
      swingOutlook: {
        signal: 'BUY',
        probability: 71,
        timeframe: '1-3 Days',
        rationale:
          'Medium-term accumulation behavior and improving market breadth point to gradual upside skew.',
      },
    },
    {
      asset: 'ADA',
      shortTermOutlook: {
        signal: 'SELL',
        probability: 76,
        timeframe: '1-4 Hours',
        rationale:
          'Weak rebound quality and persistent offer pressure suggest sellers retain short-horizon control.',
      },
      swingOutlook: {
        signal: 'HOLD',
        probability: 63,
        timeframe: '1-3 Days',
        rationale:
          'The broader structure is undecided, so risk-adjusted positioning favors patience over aggressive directional exposure.',
      },
    },
  ];
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

  const shortBias = consensus.tech_score * 0.45 + consensus.psych_score * 0.25 + consensus.onchain_score * 0.3 - 50;
  const swingBias = consensus.macro_score * 0.35 + consensus.risk_score * 0.25 + consensus.deep_memory_score * 0.4 - 50;
  const shortSignal = toAdvisorySignal(shortBias);
  const swingSignal = toAdvisorySignal(swingBias);
  const shortProbability = clampProbability(Math.abs(shortBias) + 60);
  const swingProbability = clampProbability(Math.abs(swingBias) + 58);

  return {
    asset: normalizeAsset(symbol),
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
  if (!options.useLiveAnalysis) return getMockForecasts();

  const liveResults = await Promise.all(TOP_ASSETS.map((symbol) => buildLiveForecastForAsset(symbol).catch(() => null)));
  const valid = liveResults.filter((item): item is AssetForecast => item != null);
  return valid.length > 0 ? valid : getMockForecasts();
}
