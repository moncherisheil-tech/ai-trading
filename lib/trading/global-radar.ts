/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   GLOBAL TOP-10 RADAR  ·  Omega Sentinel Phase 2                ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Scans the entire Binance USDT universe every 30 minutes.       ║
 * ║  Identifies the Top-10 High-Potential Assets by:                ║
 * ║    1. RSI momentum across H1 timeframe                          ║
 * ║    2. Volume anomaly (24h volume vs 7-day average proxy)        ║
 * ║    3. Social/news momentum (CryptoCompare headline count)       ║
 * ║  Output: Alpha Score (0–100) + Morning/Mid-day Briefing text.   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { fetchLatestCryptoNews } from '@/lib/agents/news-agent';

// ─── Types ────────────────────────────────────────────────────────────────

export interface RadarCandidate {
  symbol: string;
  alphaScore: number;         // 0–100 composite score
  rsi1h: number;              // H1 RSI
  volumeUsd24h: number;       // 24h traded volume in USD
  volumeAnomalyPct: number;   // % above/below recent median volume (proxy)
  priceChangePct24h: number;  // 24h price change %
  newsHeadlineCount: number;  // # relevant headlines (social proxy)
  currentPrice: number;
  reasoning: string;
}

export interface GlobalRadarResult {
  top10: RadarCandidate[];
  totalScanned: number;
  scanDurationMs: number;
  briefingText: string;       // Telegram-ready Morning/Mid-day Briefing
  generatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/24hr';
const BINANCE_KLINES_URL = 'https://api.binance.com/api/v3/klines';
const FETCH_TIMEOUT_MS = 10_000;
const MIN_VOLUME_USD = 3_000_000;       // $3M min 24h volume — eliminates illiquid coins
const MAX_CANDIDATES_FOR_RSI = 60;      // Fetch RSI for only top 60 by volume (CPU bound)
const RATE_LIMIT_BATCH_SIZE = 10;       // Max concurrent Binance klines requests
const RATE_LIMIT_DELAY_MS = 250;        // Delay between batches to avoid 429 errors
const RSI_PERIOD = 14;
const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;
const RSI_SWEET_SPOT_MIN = 45;          // RSI between 45–65 = accumulation zone
const RSI_SWEET_SPOT_MAX = 65;

// Score weights (must sum to 1.0)
const W_RSI = 0.35;
const W_VOLUME_ANOMALY = 0.35;
const W_NEWS = 0.15;
const W_PRICE_MOMENTUM = 0.15;

// ─── Binance ticker ────────────────────────────────────────────────────────

interface BinanceTicker {
  symbol: string;
  priceChangePercent: string;
  volume: string;   // asset volume
  quoteVolume: string; // USD equivalent
  lastPrice: string;
}

async function fetchAllUSDTTickers(): Promise<BinanceTicker[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(BINANCE_TICKER_URL, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const all = (await res.json()) as BinanceTicker[];
    return all.filter((t) => t.symbol.endsWith('USDT'));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── RSI calculation ──────────────────────────────────────────────────────

function calcRSI(closes: number[], period = RSI_PERIOD): number {
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
  return Math.round(100 - 100 / (1 + avgGain / avgLoss));
}

async function fetchH1RSI(symbol: string): Promise<number> {
  const url = `${BINANCE_KLINES_URL}?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=30`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return 50;
    const raw = (await res.json()) as [unknown, unknown, unknown, unknown, string, ...unknown[]][];
    const closes = raw.map((k) => parseFloat(k[4])).filter(Number.isFinite);
    return calcRSI(closes);
  } catch {
    return 50;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Alpha Score calculation ──────────────────────────────────────────────

/**
 * Converts RSI into a 0–100 RSI score.
 * Sweet spot: RSI 45–65 scores highest (~90).
 * Overbought (>70) or oversold (<30) score lower — avoid chasing.
 */
function rsiScore(rsi: number): number {
  if (rsi >= RSI_SWEET_SPOT_MIN && rsi <= RSI_SWEET_SPOT_MAX) return 90;
  if (rsi >= 38 && rsi < RSI_SWEET_SPOT_MIN) return 70; // slight dip — potential entry
  if (rsi > RSI_SWEET_SPOT_MAX && rsi < RSI_OVERBOUGHT) return 65; // momentum building
  if (rsi >= RSI_OVERBOUGHT) return 30; // overbought — high risk
  if (rsi <= RSI_OVERSOLD) return 40;   // oversold bounce potential
  return 50;
}

/**
 * Volume anomaly score: the higher the 24h volume relative to market median,
 * the higher the score (capped at 100).
 */
function volumeAnomalyScore(volumeUsd24h: number, medianVolume: number): number {
  if (medianVolume === 0) return 50;
  const ratio = volumeUsd24h / medianVolume;
  if (ratio >= 5) return 95;
  if (ratio >= 3) return 85;
  if (ratio >= 2) return 75;
  if (ratio >= 1.5) return 65;
  if (ratio >= 1) return 55;
  return 30;
}

/**
 * Price momentum score: modest positive momentum is bullish,
 * extreme moves are penalised (chase risk), negative is bearish.
 */
function priceMomentumScore(changePct: number): number {
  if (changePct >= 3 && changePct <= 12) return 85;
  if (changePct > 12) return 50;         // extreme pump — risky
  if (changePct >= 0.5) return 70;
  if (changePct >= -1) return 55;        // slight dip — still viable
  return 30;                             // strong dump
}

/** News score: more headlines = more social buzz. */
function newsScore(headlineCount: number): number {
  if (headlineCount >= 5) return 90;
  if (headlineCount >= 3) return 75;
  if (headlineCount >= 1) return 60;
  return 40;
}

function buildReasoning(c: Omit<RadarCandidate, 'reasoning' | 'alphaScore'>): string {
  const rsiTag = c.rsi1h >= RSI_SWEET_SPOT_MIN && c.rsi1h <= RSI_SWEET_SPOT_MAX
    ? 'RSI in accumulation zone' : c.rsi1h >= RSI_OVERBOUGHT
    ? 'RSI overbought' : c.rsi1h <= RSI_OVERSOLD
    ? 'RSI oversold bounce' : `RSI=${c.rsi1h}`;
  const volTag = c.volumeAnomalyPct > 80 ? 'Volume surge detected' : `Volume normal (${c.volumeAnomalyPct.toFixed(0)}% of median)`;
  const newsTag = c.newsHeadlineCount > 0 ? `${c.newsHeadlineCount} news signals` : 'No news';
  return `${rsiTag} · ${volTag} · ${newsTag} · 24h Δ${c.priceChangePct24h.toFixed(2)}%`;
}

// ─── Rate-limited batch fetcher ───────────────────────────────────────────

/**
 * Executes async tasks in batches with a staggered delay between batches.
 * Prevents 429 Too Many Requests from Binance by throttling parallel requests.
 */
async function batchedFetch<T>(
  tasks: Array<() => Promise<T>>,
  batchSize = RATE_LIMIT_BATCH_SIZE,
  delayMs = RATE_LIMIT_DELAY_MS,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map((fn) => fn()));
    results.push(...batchResults);
    if (i + batchSize < tasks.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

// ─── News fetch (limited to top candidates) ───────────────────────────────

async function fetchNewsCount(symbol: string): Promise<number> {
  try {
    const headlines = await fetchLatestCryptoNews(symbol);
    return headlines.length;
  } catch {
    return 0;
  }
}

// ─── Morning Briefing formatter ───────────────────────────────────────────

function buildBriefingText(top10: RadarCandidate[], isEvening: boolean): string {
  const hour = new Date().getHours();
  const greeting = isEvening
    ? '🌙 *דוח ערב — Top-10 Alpha Radar*'
    : hour < 12
    ? '🌅 *דוח בוקר — Top-10 Alpha Radar*'
    : '☀️ *דוח צהריים — Top-10 Alpha Radar*';

  const scanTime = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const lines: string[] = [
    greeting,
    `📅 ${new Date().toLocaleDateString('he-IL')} · 🕐 ${scanTime} UTC`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ];

  top10.forEach((c, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
    const dirArrow = c.priceChangePct24h >= 0 ? '▲' : '▼';
    const vol = c.volumeUsd24h >= 1_000_000
      ? `$${(c.volumeUsd24h / 1_000_000).toFixed(1)}M`
      : `$${(c.volumeUsd24h / 1_000).toFixed(0)}K`;
    lines.push(
      `${medal} *${c.symbol.replace('USDT', '')}*  Alpha: \`${c.alphaScore}%\``,
      `   💲 ${c.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })} | ${dirArrow} ${Math.abs(c.priceChangePct24h).toFixed(2)}% | Vol: ${vol}`,
      `   📊 RSI(1h)=${c.rsi1h} | ${c.reasoning}`,
      '',
    );
  });

  lines.push(
    '━━━━━━━━━━━━━━━━━━━━━━',
    '_סריקה על כל זוגות USDT בבינאנס · ניתוח: RSI + נפח + חדשות_',
  );

  return lines.join('\n');
}

// ─── Main scanner ─────────────────────────────────────────────────────────

/**
 * Runs the Global Top-10 Radar scan.
 * Call this from the 30-minute cron job.
 *
 * @param isEvening  Set to true for the evening briefing format
 */
export async function runGlobalRadar(isEvening = false): Promise<GlobalRadarResult> {
  const t0 = Date.now();

  // 1. Fetch all USDT tickers
  const allTickers = await fetchAllUSDTTickers();
  if (allTickers.length === 0) {
    return {
      top10: [],
      totalScanned: 0,
      scanDurationMs: Date.now() - t0,
      briefingText: '⚠️ Radar offline — Binance ticker fetch failed.',
      generatedAt: new Date().toISOString(),
    };
  }

  // 2. Filter by minimum volume
  const volumeFiltered = allTickers
    .map((t) => ({
      symbol: t.symbol,
      volumeUsd24h: parseFloat(t.quoteVolume) || 0,
      priceChangePct24h: parseFloat(t.priceChangePercent) || 0,
      currentPrice: parseFloat(t.lastPrice) || 0,
    }))
    .filter((t) => t.volumeUsd24h >= MIN_VOLUME_USD)
    .sort((a, b) => b.volumeUsd24h - a.volumeUsd24h);

  const totalScanned = volumeFiltered.length;

  // 3. Take top candidates by volume for RSI analysis
  const topByVolume = volumeFiltered.slice(0, MAX_CANDIDATES_FOR_RSI);

  // Compute median volume for anomaly scoring
  const volumes = topByVolume.map((t) => t.volumeUsd24h).sort((a, b) => a - b);
  const medianVolume = volumes[Math.floor(volumes.length / 2)] ?? 1;

  // 4. Fetch H1 RSI for all candidates in rate-limited batches (10 at a time, 250ms delay)
  // Prevents 429 Too Many Requests from Binance klines endpoint.
  const rsiResults = await batchedFetch(
    topByVolume.map((t) => () => fetchH1RSI(t.symbol))
  );

  // 5. Build candidates with scores (no news yet — too slow for 60 coins)
  const scoredCandidates = topByVolume.map((t, i) => {
    const rsi = rsiResults[i]?.status === 'fulfilled'
      ? (rsiResults[i] as PromiseFulfilledResult<number>).value
      : 50;
    const volumeAnomalyPct = (t.volumeUsd24h / medianVolume) * 100;

    const score = Math.round(
      W_RSI * rsiScore(rsi) +
      W_VOLUME_ANOMALY * volumeAnomalyScore(t.volumeUsd24h, medianVolume) +
      W_NEWS * 50 +  // news score placeholder (filled for top 10 below)
      W_PRICE_MOMENTUM * priceMomentumScore(t.priceChangePct24h)
    );

    return { ...t, rsi1h: rsi, volumeAnomalyPct, score };
  });

  // 6. Take top 10 by pre-score, then add news signal
  const preTop10 = scoredCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const newsResults = await batchedFetch(
    preTop10.map((c) => () => fetchNewsCount(c.symbol)),
    5,
    250
  );

  // 7. Final Alpha Score with news
  const top10: RadarCandidate[] = preTop10.map((c, i) => {
    const headlineCount = newsResults[i]?.status === 'fulfilled'
      ? (newsResults[i] as PromiseFulfilledResult<number>).value
      : 0;

    const alphaScore = Math.min(100, Math.round(
      W_RSI * rsiScore(c.rsi1h) +
      W_VOLUME_ANOMALY * volumeAnomalyScore(c.volumeUsd24h, medianVolume) +
      W_NEWS * newsScore(headlineCount) +
      W_PRICE_MOMENTUM * priceMomentumScore(c.priceChangePct24h)
    ));

    const partial: Omit<RadarCandidate, 'reasoning' | 'alphaScore'> = {
      symbol: c.symbol,
      rsi1h: c.rsi1h,
      volumeUsd24h: c.volumeUsd24h,
      volumeAnomalyPct: c.volumeAnomalyPct,
      priceChangePct24h: c.priceChangePct24h,
      newsHeadlineCount: headlineCount,
      currentPrice: c.currentPrice,
    };

    return {
      ...partial,
      alphaScore,
      reasoning: buildReasoning(partial),
    };
  });

  // Sort final top10 by alphaScore descending
  top10.sort((a, b) => b.alphaScore - a.alphaScore);

  const briefingText = buildBriefingText(top10, isEvening);

  return {
    top10,
    totalScanned,
    scanDurationMs: Date.now() - t0,
    briefingText,
    generatedAt: new Date().toISOString(),
  };
}
