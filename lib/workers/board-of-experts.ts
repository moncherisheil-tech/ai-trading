import { GoogleGenerativeAI } from '@google/generative-ai';
import { withGeminiRateLimitRetry } from '@/lib/gemini-model';
import { XMLParser } from 'fast-xml-parser';
import { APP_CONFIG } from '@/lib/config';
import { getGeminiApiKey } from '@/lib/env';
import { getMacroPulse } from '@/lib/macro-service';
import { getMarketRiskSentiment } from '@/lib/market-sentinel';
import { listClosedVirtualTrades } from '@/lib/db/virtual-portfolio';
import { getVirtualPortfolioSummary } from '@/lib/simulation-service';
import { listHistoricalPredictions } from '@/lib/db/historical-predictions';
import { listRecentAlertedSymbolsSince, listRecentScannerAlertsSince } from '@/lib/db/scanner-alert-log';
import { recordBoardMeetingLog } from '@/lib/db/board-meeting-logs';
import { escapeHtml } from '@/lib/telegram';
import { rsi } from '@/lib/indicators';
import { storeBoardMeetingMemory } from '@/lib/vector-db';

const FNG_URL = 'https://api.alternative.me/fng/?limit=1';
const RSS_FEEDS = [
  'https://cointelegraph.com/rss',
  'https://cryptopanic.com/news/rss/',
];
const FETCH_TIMEOUT_MS = 8_000;
const LAST_24H_MS = 24 * 60 * 60 * 1000;
const BINANCE_MIN_QUOTE_VOLUME_USD = 5_000_000;

type Stance = 'bullish' | 'bearish' | 'neutral';

export interface FearGreedSnapshot {
  value: number | null;
  valueClassification: string;
  fetchedAt: string;
}

export interface ExpertOutput {
  expert: string;
  stance: Stance;
  confidence: number;
  reasoning: string;
  action: string;
}

export interface OverseerOutput {
  finalVerdict: 'go' | 'caution' | 'no-go';
  boardSummary: string;
  conflictResolution: string;
  actionPlan: string;
}

export interface BoardMeetingResult {
  fearGreed: FearGreedSnapshot;
  topHeadlines: string[];
  experts: Record<string, ExpertOutput>;
  overseer: OverseerOutput;
}

interface Binance24hRow {
  symbol: string;
  priceChangePercent: number;
  quoteVolume: number;
}

interface Binance24hRawRow {
  symbol?: string;
  quoteVolume?: string;
  priceChangePercent?: string;
}

interface DexScreenerBoostRow {
  chainId?: string;
  tokenAddress?: string;
  amount?: number;
  totalAmount?: number;
}

interface DexScreenerPairRow {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { symbol?: string };
  quoteToken?: { symbol?: string };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
  url?: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function parseJsonObject(text: string): string {
  const trimmed = text.trim();
  const clean = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/, '').trim()
    : trimmed;
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}') + 1;
  return first >= 0 && last > first ? clean.slice(first, last) : clean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1]! + sorted[m]!) / 2 : sorted[m]!;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchFearGreedLive(): Promise<FearGreedSnapshot> {
  try {
    const res = await fetchWithTimeout(FNG_URL);
    if (!res.ok) throw new Error('Fear & Greed API failed');
    const data = (await res.json()) as { data?: Array<{ value?: string; value_classification?: string }> };
    const row = data.data?.[0];
    const raw = row?.value != null ? parseInt(row.value, 10) : NaN;
    const value = Number.isFinite(raw) ? clamp(raw, 0, 100) : null;
    return {
      value,
      valueClassification: row?.value_classification ?? 'Data Unavailable',
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return {
      value: null,
      valueClassification: 'Data Unavailable',
      fetchedAt: new Date().toISOString(),
    };
  }
}

export async function fetchTopCryptoHeadlines(limit = 5): Promise<string[]> {
  const parser = new XMLParser({ ignoreAttributes: false });
  for (const feed of RSS_FEEDS) {
    try {
      const res = await fetchWithTimeout(feed);
      if (!res.ok) continue;
      const xml = await res.text();
      const parsed = parser.parse(xml) as {
        rss?: { channel?: { item?: Array<{ title?: string }> | { title?: string } } };
        feed?: { entry?: Array<{ title?: string | { '#text'?: string } }> | { title?: string | { '#text'?: string } } };
      };
      const channelItems = parsed.rss?.channel?.item;
      const atomEntries = parsed.feed?.entry;
      const rows = Array.isArray(channelItems)
        ? channelItems
        : channelItems
          ? [channelItems]
          : Array.isArray(atomEntries)
            ? atomEntries
            : atomEntries
              ? [atomEntries]
              : [];
      const headlines = rows
        .map((row) => {
          const rawTitle = (row as { title?: string | { '#text'?: string } }).title;
          if (typeof rawTitle === 'string') return rawTitle.trim();
          if (rawTitle && typeof rawTitle['#text'] === 'string') return rawTitle['#text'].trim();
          return '';
        })
        .filter(Boolean)
        .slice(0, limit);
      if (headlines.length > 0) return headlines;
    } catch {
      // try next feed
    }
  }
  return [];
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let out = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) out = values[i]! * k + out * (1 - k);
  return out;
}

function macdSignal(closes: number[]): number | null {
  if (closes.length < 35) return null;
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  if (e12 == null || e26 == null) return null;
  return e12 - e26;
}

async function fetchKlineSeries(symbol: string, interval = '1h', limit = 120): Promise<{
  closes: number[];
  volumes: number[];
}> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { closes: [], volumes: [] };
    const rows = (await res.json()) as Array<[number, string, string, string, string, string]>;
    const closes = rows.map((r) => parseFloat(r[4] ?? '0')).filter((n) => Number.isFinite(n) && n > 0);
    const volumes = rows.map((r) => parseFloat(r[5] ?? '0')).filter((n) => Number.isFinite(n) && n >= 0);
    return { closes, volumes };
  } catch {
    return { closes: [], volumes: [] };
  }
}

async function fetch24hTicker(symbol: string): Promise<Binance24hRow | null> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { symbol?: string; priceChangePercent?: string; quoteVolume?: string };
    const priceChangePercent = Number.parseFloat(data.priceChangePercent ?? '');
    const quoteVolume = Number.parseFloat(data.quoteVolume ?? '');
    if (!Number.isFinite(priceChangePercent) || !Number.isFinite(quoteVolume)) return null;
    return {
      symbol: data.symbol ?? symbol,
      priceChangePercent,
      quoteVolume,
    };
  } catch {
    return null;
  }
}

async function fetchBinanceWhaleProxy(limit = 5): Promise<{
  source: 'binance-public';
  fetchedAt: string;
  baselineQuoteVolumeUsd: number;
  topVolumeAnomalies: Array<{
    symbol: string;
    quoteVolumeUsd: number;
    priceChangePercent: number;
    volumeZScore: number;
    anomalyScore: number;
  }>;
} | null> {
  const base = APP_CONFIG.proxyBinanceUrl || 'https://api.binance.com';
  const url = `${base.replace(/\/$/, '')}/api/v3/ticker/24hr`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const rows = (await res.json()) as Binance24hRawRow[];
    const candidates = rows
      .map((row) => ({
        symbol: String(row.symbol || '').toUpperCase(),
        quoteVolumeUsd: Number.parseFloat(row.quoteVolume ?? '0') || 0,
        priceChangePercent: Number.parseFloat(row.priceChangePercent ?? '0') || 0,
      }))
      .filter(
        (row) =>
          row.symbol.endsWith('USDT') &&
          Number.isFinite(row.quoteVolumeUsd) &&
          row.quoteVolumeUsd >= BINANCE_MIN_QUOTE_VOLUME_USD
      );
    if (candidates.length === 0) return null;

    const logVolumes = candidates.map((row) => Math.log10(row.quoteVolumeUsd));
    const logMedian = median(logVolumes);
    const absDeviation = logVolumes.map((v) => Math.abs(v - logMedian));
    const mad = median(absDeviation) || 0.1;
    const scale = 1.4826 * mad;

    return {
      source: 'binance-public',
      fetchedAt: new Date().toISOString(),
      baselineQuoteVolumeUsd: Number(Math.pow(10, logMedian).toFixed(2)),
      topVolumeAnomalies: candidates
        .map((row) => {
          const logV = Math.log10(row.quoteVolumeUsd);
          const volumeZScore = (logV - logMedian) / scale;
          // "Sudden" component: unusual volume + strong 24h directional move.
          const momentumBoost = clamp(Math.abs(row.priceChangePercent) / 10, 0, 2);
          const anomalyScore = volumeZScore + momentumBoost;
          return {
            symbol: row.symbol,
            quoteVolumeUsd: Number(row.quoteVolumeUsd.toFixed(2)),
            priceChangePercent: Number(row.priceChangePercent.toFixed(2)),
            volumeZScore: Number(volumeZScore.toFixed(2)),
            anomalyScore: Number(anomalyScore.toFixed(2)),
          };
        })
        .sort((a, b) => b.anomalyScore - a.anomalyScore)
        .slice(0, limit),
    };
  } catch {
    return null;
  }
}

async function fetchDexScreenerTrendingPairs(limit = 5): Promise<{
  source: 'dexscreener-public';
  fetchedAt: string;
  topTrendingPairs: Array<{
    chainId: string;
    dexId: string;
    pair: string;
    pairAddress: string;
    h24VolumeUsd: number;
    liquidityUsd: number;
    h24PriceChangePct: number;
    url: string;
  }>;
} | null> {
  const boostUrls = [
    'https://api.dexscreener.com/token-boosts/top/v1',
    'https://api.dexscreener.com/token-boosts/latest/v1',
  ];
  try {
    let boosts: DexScreenerBoostRow[] = [];
    for (const endpoint of boostUrls) {
      const res = await fetchWithTimeout(endpoint);
      if (!res.ok) continue;
      const data = (await res.json()) as DexScreenerBoostRow[];
      if (Array.isArray(data) && data.length > 0) {
        boosts = data;
        break;
      }
    }
    if (boosts.length === 0) return null;

    const uniqueBoosts = boosts
      .filter((b) => b.chainId && b.tokenAddress)
      .slice(0, 12);
    if (uniqueBoosts.length === 0) return null;

    const pairCandidates = await Promise.all(
      uniqueBoosts.map(async (boost) => {
        const chainId = String(boost.chainId);
        const tokenAddress = String(boost.tokenAddress);
        const url = `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`;
        try {
          const res = await fetchWithTimeout(url);
          if (!res.ok) return null;
          const rows = (await res.json()) as DexScreenerPairRow[];
          if (!Array.isArray(rows) || rows.length === 0) return null;
          const best = rows
            .filter((p) => Number(p.volume?.h24 || 0) > 0 && Number(p.liquidity?.usd || 0) > 0)
            .sort((a, b) => Number(b.volume?.h24 || 0) - Number(a.volume?.h24 || 0))[0];
          if (!best) return null;
          return {
            chainId: String(best.chainId || chainId),
            dexId: String(best.dexId || 'unknown'),
            pair: `${String(best.baseToken?.symbol || 'UNKNOWN')}/${String(best.quoteToken?.symbol || 'UNKNOWN')}`,
            pairAddress: String(best.pairAddress || ''),
            h24VolumeUsd: Number(Number(best.volume?.h24 || 0).toFixed(2)),
            liquidityUsd: Number(Number(best.liquidity?.usd || 0).toFixed(2)),
            h24PriceChangePct: Number(Number(best.priceChange?.h24 || 0).toFixed(2)),
            url: String(best.url || ''),
            boostAmount: Number(boost.amount || 0),
            boostTotalAmount: Number(boost.totalAmount || 0),
          };
        } catch {
          return null;
        }
      })
    );

    const topTrendingPairs = pairCandidates
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => {
        const scoreA = a.h24VolumeUsd + a.boostTotalAmount * 10_000 + a.boostAmount * 1_000;
        const scoreB = b.h24VolumeUsd + b.boostTotalAmount * 10_000 + b.boostAmount * 1_000;
        return scoreB - scoreA;
      })
      .slice(0, limit)
      .map(({ boostAmount, boostTotalAmount, ...row }) => row);

    if (topTrendingPairs.length === 0) return null;
    return {
      source: 'dexscreener-public',
      fetchedAt: new Date().toISOString(),
      topTrendingPairs,
    };
  } catch {
    return null;
  }
}

async function callExpert(
  expertName: string,
  domainGuardrail: string,
  dataset: Record<string, unknown>
): Promise<ExpertOutput> {
  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const model = genAI.getGenerativeModel({
    model: APP_CONFIG.primaryModel || 'gemini-2.0-flash',
  });
  const prompt = `System instruction: Return only raw JSON. No markdown. No prose before/after JSON. Use only data given by the user.

Role: ${expertName}
Scope lock: ${domainGuardrail}

Dataset (JSON):
${JSON.stringify(dataset, null, 2)}

Output strictly as JSON with these keys exactly:
{
  "expert": "${expertName}",
  "stance": "bullish|bearish|neutral",
  "confidence": 0-100,
  "reasoning": "short rationale",
  "action": "clear action recommendation from this expert"
}`;
  try {
    const result = await withGeminiRateLimitRetry(() =>
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 600,
          responseMimeType: 'application/json',
        },
      })
    );
    const parsed = JSON.parse(parseJsonObject(result.response.text() ?? '')) as Partial<ExpertOutput>;
    const stance = parsed.stance === 'bullish' || parsed.stance === 'bearish' || parsed.stance === 'neutral'
      ? parsed.stance
      : 'neutral';
    return {
      expert: expertName,
      stance,
      confidence: clamp(Number(parsed.confidence) || 50, 0, 100),
      reasoning: String(parsed.reasoning ?? 'No reasoning available').slice(0, 300),
      action: String(parsed.action ?? 'Hold neutral and wait for more data.').slice(0, 220),
    };
  } catch {
    return {
      expert: expertName,
      stance: 'neutral',
      confidence: 0,
      reasoning: 'Data Unavailable: required live APIs or model response failed for this cycle.',
      action: 'Data Unavailable',
    };
  }
}

async function runOverseer(experts: Record<string, ExpertOutput>): Promise<OverseerOutput> {
  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const model = genAI.getGenerativeModel({
    model: APP_CONFIG.primaryModel || 'gemini-2.0-flash',
  });
  const prompt = `System instruction: You are a CEO-level overseer. Do not do raw analysis. Only synthesize experts JSON. Output only valid JSON.

You are the Overseer (CEO). You must only consume the 6 expert JSON outputs below.

Experts JSON:
${JSON.stringify(experts, null, 2)}

Instructions:
1) Resolve conflicts explicitly (for example: technical bullish but sentiment+risk bearish).
2) Return a decisive executive verdict.
3) Do not invent new data.

Output JSON exactly:
{
  "finalVerdict": "go|caution|no-go",
  "boardSummary": "short board meeting summary",
  "conflictResolution": "how conflicts were resolved",
  "actionPlan": "decisive next actions"
}`;
  try {
    const result = await withGeminiRateLimitRetry(() =>
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 700,
          responseMimeType: 'application/json',
        },
      })
    );
    const parsed = JSON.parse(parseJsonObject(result.response.text() ?? '')) as Partial<OverseerOutput>;
    const finalVerdict = parsed.finalVerdict === 'go' || parsed.finalVerdict === 'caution' || parsed.finalVerdict === 'no-go'
      ? parsed.finalVerdict
      : 'caution';
    return {
      finalVerdict,
      boardSummary: String(parsed.boardSummary ?? 'Board summary unavailable.').slice(0, 320),
      conflictResolution: String(parsed.conflictResolution ?? 'Conflicts could not be resolved.').slice(0, 320),
      actionPlan: String(parsed.actionPlan ?? 'Stay defensive until stronger confirmation.').slice(0, 320),
    };
  } catch {
    return {
      finalVerdict: 'caution',
      boardSummary: 'Data Unavailable: Overseer synthesis failed this cycle.',
      conflictResolution: 'Data Unavailable',
      actionPlan: 'Pause autonomous decisions and retry when live data is restored.',
    };
  }
}

export async function runBoardOfExperts(context: 'morning' | 'evening'): Promise<BoardMeetingResult> {
  const [fearGreed, topHeadlines, recentSymbols, recentAlerts, portfolio, marketRisk, macro, historical, closedTrades] =
    await Promise.all([
      fetchFearGreedLive(),
      fetchTopCryptoHeadlines(5),
      listRecentAlertedSymbolsSince({ sinceMs: LAST_24H_MS, limit: 8 }),
      listRecentScannerAlertsSince({ sinceMs: LAST_24H_MS, limit: 250 }),
      getVirtualPortfolioSummary(),
      getMarketRiskSentiment(),
      getMacroPulse(),
      listHistoricalPredictions(120),
      listClosedVirtualTrades(120),
    ]);

  const focusSymbols = Array.from(new Set(['BTCUSDT', ...recentSymbols])).slice(0, 4);
  const symbolSeries = await Promise.all(
    focusSymbols.map(async (symbol) => ({
      symbol,
      series: await fetchKlineSeries(symbol, '1h', 120),
      ticker24h: await fetch24hTicker(symbol),
    }))
  );

  const technicalSnapshot = symbolSeries.map(({ symbol, series }) => {
    const closes = series.closes;
    const volumes = series.volumes;
    const rsi14 = closes.length > 15 ? rsi(closes, 14) : null;
    const macd = macdSignal(closes);
    const lastVol = volumes.length > 0 ? volumes[volumes.length - 1]! : 0;
    const avgVol = volumes.length > 10
      ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10
      : 0;
    return {
      symbol,
      rsi14: rsi14 != null ? Number(rsi14.toFixed(2)) : 'Data Unavailable',
      macdSignal: macd != null ? Number(macd.toFixed(4)) : null,
      volumeSpikeRatio: avgVol > 0 ? Number((lastVol / avgVol).toFixed(2)) : null,
    };
  });

  const altTickers = symbolSeries
    .filter((s) => s.ticker24h && s.symbol !== 'BTCUSDT')
    .map((s) => s.ticker24h as Binance24hRow);
  const btcTicker = symbolSeries.find((s) => s.symbol === 'BTCUSDT')?.ticker24h ?? null;
  const avgAltPerf = altTickers.length > 0
    ? altTickers.reduce((sum, t) => sum + t.priceChangePercent, 0) / altTickers.length
    : null;

  const wins = closedTrades.filter((t) => (t.pnl_pct ?? 0) > 0);
  const avgWinningDurationHours = wins.length > 0
    ? wins.reduce((sum, t) => {
      if (!t.closed_at) return sum;
      const h = (new Date(t.closed_at).getTime() - new Date(t.entry_date).getTime()) / 3_600_000;
      return sum + (Number.isFinite(h) && h > 0 ? h : 0);
    }, 0) / wins.length
    : 0;

  const breakoutSpeeds = symbolSeries.map(({ symbol, series }) => {
    if (series.closes.length < 7) return { symbol, sixHourChangePct: 0 };
    const last = series.closes[series.closes.length - 1]!;
    const prev = series.closes[series.closes.length - 7]!;
    const pct = prev > 0 ? ((last - prev) / prev) * 100 : 0;
    return { symbol, sixHourChangePct: Number(pct.toFixed(2)) };
  });

  const expert1Data = {
    context,
    technicalSnapshot,
  };
  const expert2Data = {
    context,
    fearGreedValue: fearGreed.value,
    fearGreedClassification: fearGreed.valueClassification,
    topHeadlines,
  };
  const expert3Data = {
    context,
    wallet: {
      winRatePct: portfolio.winRatePct,
      dailyPnlPct: portfolio.dailyPnlPct,
      totalVirtualBalancePct: portfolio.totalVirtualBalancePct,
      openCount: portfolio.openCount,
      closedCount: portfolio.closedCount,
    },
    volatility: {
      marketRiskStatus: marketRisk.status,
      btc24hVolatilityPct: marketRisk.btc24hVolatilityPct,
      eth24hVolatilityPct: marketRisk.eth24hVolatilityPct,
      btcAtrPct: marketRisk.btcAtrPct,
      ethAtrPct: marketRisk.ethAtrPct,
    },
  };
  const [binanceWhaleProxy, dexTrendingProxy] = await Promise.all([
    fetchBinanceWhaleProxy(5),
    fetchDexScreenerTrendingPairs(5),
  ]);
  const expert4Data = {
    context,
    whaleProxySignals: {
      binanceVolumeProxy: binanceWhaleProxy ?? 'Data Unavailable',
      dexTrendingProxy: dexTrendingProxy ?? 'Data Unavailable',
    },
    providerStatus:
      binanceWhaleProxy != null || dexTrendingProxy != null
        ? 'Live public APIs active (Binance + DEX Screener).'
        : 'Data Unavailable: Binance and DEX Screener APIs both failed in this cycle.',
    recentAlertAnomalies: recentAlerts.slice(0, 40),
    anomalyCountsBySymbol: (Object.entries(
      recentAlerts.reduce<Record<string, number>>((acc, row) => {
        acc[row.symbol] = (acc[row.symbol] ?? 0) + 1;
        return acc;
      }, {})
    ) as Array<[string, number]>)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([symbol, count]) => ({ symbol, count })),
    note: 'Whale detection is derived from public exchange volume anomalies and trending on-chain DEX liquidity migrations.',
  };
  const expert5Data = {
    context,
    btc24hPerformancePct: btcTicker?.priceChangePercent ?? 'Data Unavailable',
    averageAlt24hPerformancePct: avgAltPerf != null ? Number(avgAltPerf.toFixed(2)) : 'Data Unavailable',
    btcDominancePct: macro.btcDominancePct,
    macroSentimentScore: macro.macroSentimentScore,
    recentScanLiquidityProxyCount: recentAlerts.length,
  };
  const expert6Data = {
    context,
    breakoutSpeeds,
    avgWinningTradeDurationHours: Number(avgWinningDurationHours.toFixed(2)),
    recentHistoricalOutcomes: historical.slice(0, 20).map((h) => ({
      symbol: h.symbol,
      predictedDirection: h.predicted_direction,
      priceDiffPct: h.price_diff_pct,
      probability: h.probability,
    })),
  };

  const [
    technicalExpert,
    sentimentExpert,
    riskExpert,
    onchainExpert,
    macroExpert,
    momentumExpert,
  ] = await Promise.all([
    callExpert(
      'Expert 1 — Technical Analyst',
      'Use only technicalSnapshot: price action, volume spikes, RSI, MACD.',
      expert1Data
    ),
    callExpert(
      'Expert 2 — Sentiment/Fundamental Analyst',
      'Use only Fear & Greed and RSS headlines. No chart or wallet analysis.',
      expert2Data
    ),
    callExpert(
      'Expert 3 — Risk Manager',
      'Use only wallet PnL, win rate, and volatility metrics.',
      expert3Data
    ),
    callExpert(
      'Expert 4 — Volume & Liquidity Sniper',
      'Use only whaleProxySignals and anomaly summaries to infer where smart money is flowing now.',
      expert4Data
    ),
    callExpert(
      'Expert 5 — Macro Economist',
      'Use only BTC vs Alt performance, dominance, macro score, and liquidity proxies.',
      expert5Data
    ),
    callExpert(
      'Expert 6 — Momentum Scout',
      'Use only breakout speed and duration of successful trades.',
      expert6Data
    ),
  ]);

  const experts = {
    expert1: technicalExpert,
    expert2: sentimentExpert,
    expert3: riskExpert,
    expert4: onchainExpert,
    expert5: macroExpert,
    expert6: momentumExpert,
  };
  const overseer = await runOverseer(experts);
  await recordBoardMeetingLog({
    trigger_type: context,
    the_6_expert_verdicts: experts,
    overseer_final_action_plan: overseer.actionPlan,
    market_context: {
      fearGreed: {
        value: fearGreed.value ?? 50,
        valueClassification: fearGreed.valueClassification ?? 'Unknown',
        fetchedAt: fearGreed.fetchedAt,
      },
      topHeadlines,
      expert4LiquiditySignals: expert4Data.whaleProxySignals,
    },
  });
  const expertSummariesForMemory = Object.values(experts).map(
    (expert) =>
      `${expert.expert} | stance=${expert.stance} | confidence=${expert.confidence.toFixed(0)} | reasoning=${expert.reasoning} | action=${expert.action}`
  );
  await storeBoardMeetingMemory({
    triggerType: context,
    symbol: 'MARKET',
    source: 'board_worker',
    occurredAt: new Date().toISOString(),
    finalConsensus: [
      `verdict=${overseer.finalVerdict}`,
      `boardSummary=${overseer.boardSummary}`,
      `conflictResolution=${overseer.conflictResolution}`,
      `actionPlan=${overseer.actionPlan}`,
    ].join(' | '),
    expertSummaries: expertSummariesForMemory,
  });

  return {
    fearGreed,
    topHeadlines,
    experts,
    overseer,
  };
}

function stanceEmoji(stance: Stance): string {
  if (stance === 'bullish') return '🟢';
  if (stance === 'bearish') return '🔴';
  return '🟡';
}

export function formatBoardMeetingForTelegram(
  title: string,
  board: BoardMeetingResult
): string[] {
  const lines: string[] = [
    `<b>${escapeHtml(title)}</b>`,
    '',
    `<b>Fear & Greed (live):</b> ${board.fearGreed.value ?? 'Data Unavailable'} (${escapeHtml(board.fearGreed.valueClassification)})`,
    '',
    '<b>Top News Headlines (RSS):</b>',
    ...(board.topHeadlines.length > 0
      ? board.topHeadlines.map((h, i) => `• ${i + 1}. ${escapeHtml(h.slice(0, 140))}`)
      : ['• No RSS headlines were available in this cycle.']),
    '',
    '<b>Board of 6 Experts:</b>',
  ];

  for (const expert of Object.values(board.experts)) {
    lines.push(
      `${stanceEmoji(expert.stance)} <b>${escapeHtml(expert.expert)}</b> — ${expert.confidence.toFixed(0)}/100`,
      `• ${escapeHtml(expert.reasoning)}`
    );
  }

  lines.push(
    '',
    '<b>Overseer Final Verdict:</b>',
    `• Verdict: <b>${escapeHtml(board.overseer.finalVerdict.toUpperCase())}</b>`,
    `• Board Summary: ${escapeHtml(board.overseer.boardSummary)}`,
    `• Conflict Resolution: ${escapeHtml(board.overseer.conflictResolution)}`,
    `• Action Plan: ${escapeHtml(board.overseer.actionPlan)}`
  );

  return lines;
}
