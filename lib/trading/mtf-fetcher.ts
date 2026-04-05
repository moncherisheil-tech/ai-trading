/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   MULTI-TIMEFRAME CONFLUENCE ENGINE  ·  Omega Sentinel v1.0     ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Fetches OHLCV data from Binance public REST for 4 timeframes:  ║
 * ║    H1 (1-hour)  ·  D1 (Daily)  ·  W1 (Weekly)  ·  M1 (Monthly) ║
 * ║                                                                  ║
 * ║  Calculates EMA-20, EMA-50, RSI-14 per timeframe.               ║
 * ║  Confluence gate: signal fires only when ≥ 3/4 TFs agree.       ║
 * ║                                                                  ║
 * ║  CACHE SHIELD: Results are Redis-cached for 60 s per symbol.    ║
 * ║  10 parallel jobs → 1 Binance fetch, 9 Redis reads (RAM).       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

export type Timeframe = 'H1' | 'D1' | 'W1' | 'M1';
export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface TimeframeAnalysis {
  timeframe: Timeframe;
  trend: TrendDirection;
  rsi: number;
  ema20: number;
  ema50: number;
  lastClose: number;
  candlesAnalyzed: number;
}

export interface MTFConfluenceResult {
  symbol: string;
  /** 0–4: how many timeframes agree on the dominant direction */
  confluenceScore: number;
  dominantTrend: TrendDirection;
  alignedTimeframes: Timeframe[];
  timeframes: Partial<Record<Timeframe, TimeframeAnalysis>>;
  /** true when confluenceScore ≥ 3 (Omega Sentinel gate) */
  isConfluent: boolean;
  analysisTs: number;
}

// ─── Binance interval mapping ─────────────────────────────────────────────

const TF_TO_BINANCE: Record<Timeframe, { interval: string; limit: number }> = {
  H1: { interval: '1h', limit: 60 },
  D1: { interval: '1d', limit: 60 },
  W1: { interval: '1w', limit: 26 },
  M1: { interval: '1M', limit: 14 },
};

const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const FETCH_TIMEOUT_MS = 8_000;

// ─── Redis Cache Shield ────────────────────────────────────────────────────

const MTF_CACHE_TTL_SECONDS = 60;

function mtfCacheKey(symbol: string): string {
  return `cache:mtf:${symbol.toUpperCase()}`;
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    const { getHttpRedisClient } = await import('@/lib/queue/redis-client');
    return await getHttpRedisClient().get(key);
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    const { getHttpRedisClient } = await import('@/lib/queue/redis-client');
    await getHttpRedisClient().set(key, value, 'EX', ttlSeconds);
  } catch {
    // Non-fatal — next call will fetch from Binance
  }
}

// ─── Math helpers ─────────────────────────────────────────────────────────

/**
 * Exponential Moving Average — uses a "warm-up" of `period` seed candles
 * then continues with the multiplier k = 2 / (period + 1).
 */
function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
  }
  return ema;
}

/**
 * RSI-14 (Wilder's smoothing / exponential equivalent).
 * Returns value in [0, 100]; defaults to 50 when insufficient data.
 */
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

/**
 * Determine trend direction for one timeframe.
 * Rules (in priority order):
 *   1. Price > EMA20 > EMA50  → BULLISH
 *   2. Price < EMA20 < EMA50  → BEARISH
 *   3. RSI ≥ 55               → BULLISH
 *   4. RSI ≤ 45               → BEARISH
 *   5. Otherwise              → NEUTRAL
 */
function determineTrend(close: number, ema20: number, ema50: number, rsi: number): TrendDirection {
  if (close > ema20 && ema20 > ema50) return 'BULLISH';
  if (close < ema20 && ema20 < ema50) return 'BEARISH';
  if (rsi >= 55) return 'BULLISH';
  if (rsi <= 45) return 'BEARISH';
  return 'NEUTRAL';
}

// ─── Binance OHLCV fetch ───────────────────────────────────────────────────

type BinanceKlineRaw = [
  number,  // 0: open time
  string,  // 1: open
  string,  // 2: high
  string,  // 3: low
  string,  // 4: close
  string,  // 5: volume
  ...unknown[]
];

async function fetchBinanceKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<number[]> {
  const url = `${BINANCE_KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return [];
    const raw = (await res.json()) as BinanceKlineRaw[];
    return raw.map((k) => parseFloat(k[4])).filter(Number.isFinite);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── Single-timeframe analyzer ────────────────────────────────────────────

async function analyzeTimeframe(
  symbol: string,
  tf: Timeframe
): Promise<TimeframeAnalysis | null> {
  const { interval, limit } = TF_TO_BINANCE[tf];
  const closes = await fetchBinanceKlines(symbol, interval, limit);
  if (closes.length < 20) return null;

  const ema20 = calcEMA(closes, 20);
  const ema50 = closes.length >= 50 ? calcEMA(closes, 50) : ema20;
  const rsi = calcRSI(closes);
  const lastClose = closes[closes.length - 1]!;
  const trend = determineTrend(lastClose, ema20, ema50, rsi);

  return {
    timeframe: tf,
    trend,
    rsi,
    ema20,
    ema50,
    lastClose,
    candlesAnalyzed: closes.length,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Fetches all 4 timeframes in parallel and returns the full confluence result.
 * Gracefully handles partial failures — a missing timeframe simply does not
 * count toward the confluence score.
 *
 * Results are Redis-cached for MTF_CACHE_TTL_SECONDS (60 s) per symbol so
 * that concurrent jobs share a single Binance round-trip instead of all
 * hammering the API simultaneously.
 *
 * @param symbol  e.g. "BTCUSDT"
 */
export async function fetchMTFConfluence(symbol: string): Promise<MTFConfluenceResult> {
  const cacheKey = mtfCacheKey(symbol);

  // ── Cache hit: serve from Redis RAM ───────────────────────────────────────
  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as MTFConfluenceResult;
      return parsed;
    } catch {
      // Corrupt cache entry — fall through to live fetch
    }
  }

  const timeframes: Timeframe[] = ['H1', 'D1', 'W1', 'M1'];
  const settled = await Promise.allSettled(
    timeframes.map((tf) => analyzeTimeframe(symbol, tf))
  );

  const results: Partial<Record<Timeframe, TimeframeAnalysis>> = {};
  for (let i = 0; i < timeframes.length; i++) {
    const s = settled[i];
    if (s?.status === 'fulfilled' && s.value) {
      results[timeframes[i]!] = s.value;
    }
  }

  const analyses = Object.values(results) as TimeframeAnalysis[];

  // Count directional votes
  const bullishCount = analyses.filter((a) => a.trend === 'BULLISH').length;
  const bearishCount = analyses.filter((a) => a.trend === 'BEARISH').length;

  const dominantTrend: TrendDirection =
    bullishCount > bearishCount ? 'BULLISH' :
    bearishCount > bullishCount ? 'BEARISH' : 'NEUTRAL';

  const alignedTimeframes = analyses
    .filter((a) => a.trend === dominantTrend)
    .map((a) => a.timeframe);

  const confluenceScore = alignedTimeframes.length;
  const isConfluent = confluenceScore >= 3;

  const result: MTFConfluenceResult = {
    symbol,
    confluenceScore,
    dominantTrend,
    alignedTimeframes,
    timeframes: results,
    isConfluent,
    analysisTs: Date.now(),
  };

  // ── Cache miss: persist to Redis for concurrent consumers ─────────────────
  void cacheSet(cacheKey, JSON.stringify(result), MTF_CACHE_TTL_SECONDS);

  return result;
}

/**
 * Formats a confluence result into a compact human-readable string
 * suitable for logging and LLM context injection.
 */
export function formatMTFSummary(mtf: MTFConfluenceResult): string {
  const tfLines = (['H1', 'D1', 'W1', 'M1'] as Timeframe[])
    .map((tf) => {
      const a = mtf.timeframes[tf];
      if (!a) return `${tf}: ⚠ N/A`;
      const icon = a.trend === 'BULLISH' ? '▲' : a.trend === 'BEARISH' ? '▼' : '─';
      return `${tf}: ${icon} ${a.trend} (RSI=${a.rsi}, EMA20=${a.ema20.toFixed(4)})`;
    })
    .join(' | ');
  return (
    `MTF Confluence [${mtf.confluenceScore}/4 ` +
    `${mtf.dominantTrend}${mtf.isConfluent ? ' ✓ CONFLUENT' : ' ✗ DIVERGENT'}]: ${tfLines}`
  );
}
