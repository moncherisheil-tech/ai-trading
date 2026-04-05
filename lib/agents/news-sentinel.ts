/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   NEWS SENTINEL EXPERT  ·  Omega Sentinel Phase 3               ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  Aggregates crypto news from CryptoCompare, correlates with     ║
 * ║  price/whale anomalies, and applies three-scenario logic:       ║
 * ║                                                                  ║
 * ║  A: Spike + Positive News   → STRONG BUY confirmation           ║
 * ║  B: Spike + Negative/NoNews → MANIPULATION WARNING (BEARISH)    ║
 * ║  C: SEC/CPI/Regulatory news → PROTECT_CAPITAL risk mode         ║
 * ║                                                                  ║
 * ║  Latency budget: fetch + classify in < 2 000 ms.                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

export type NewsScenario = 'A_STRONG_BUY' | 'B_MANIPULATION_WARNING' | 'C_PROTECT_CAPITAL' | 'NEUTRAL';
export type RiskMode = 'NORMAL' | 'PROTECT_CAPITAL';

export interface NewsSentinelResult {
  scenario: NewsScenario;
  riskMode: RiskMode;
  /** Normalised sentiment in [-1, 1] */
  sentimentScore: number;
  /** Top 3 relevant headlines */
  topHeadlines: string[];
  /** True when a macro-risk event (SEC, CPI, regulation) was detected */
  macroRiskDetected: boolean;
  /** Brief LLM-generated reasoning for this scenario classification */
  reasoning: string;
  latencyMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 4_000;
const CRYPTOCOMPARE_URL = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=20';

// ─── Redis Cache Shield ────────────────────────────────────────────────────

/**
 * Global news feed is the same URL regardless of symbol — one fetch serves all
 * 10 concurrent jobs.  TTL=60 s drops external API calls by ~90%.
 * Key is symbol-specific (post-filter) to avoid cross-symbol cache poisoning.
 */
const NEWS_CACHE_TTL_SECONDS = 60;
const NEWS_RAW_CACHE_KEY = 'cache:news:raw_global';

async function newsCacheGet(key: string): Promise<string | null> {
  try {
    const { getHttpRedisClient } = await import('@/lib/queue/redis-client');
    return await getHttpRedisClient().get(key);
  } catch {
    return null;
  }
}

async function newsCacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    const { getHttpRedisClient } = await import('@/lib/queue/redis-client');
    await getHttpRedisClient().set(key, value, 'EX', ttlSeconds);
  } catch {
    // Non-fatal — next call will re-fetch from CryptoCompare
  }
}

/** Regex patterns for Scenario C (macro-risk triggers) */
const MACRO_RISK_PATTERNS = [
  /\bSEC\b/,
  /\bCFTC\b/,
  /\bCPI\b/,
  /\bFed\b.*rate/i,
  /interest rate/i,
  /regulation/i,
  /ban\b/i,
  /lawsuit/i,
  /enforcement/i,
  /inflation/i,
  /sanction/i,
  /hacker|hack\b/i,
  /exploit/i,
  /rug\s*pull/i,
];

/** Positive keywords that corroborate a price spike (Scenario A) */
const BULLISH_KEYWORDS = [
  'partnership', 'adoption', 'launch', 'upgrade', 'etf', 'institutional',
  'approval', 'listing', 'surge', 'bullish', 'rally', 'inflow', 'milestone',
  'record', 'all-time high', 'integration', 'buy', 'accumulation',
];

/** Negative keywords signalling Scenario B */
const BEARISH_KEYWORDS = [
  'sell', 'dump', 'whale exit', 'outflow', 'bearish', 'crash', 'drop',
  'decline', 'fraud', 'scam', 'fake', 'manipulation', 'suspicious',
];

// ─── News fetching ─────────────────────────────────────────────────────────

interface CryptoCompareNewsItem {
  title?: string;
  body?: string;
  tags?: string;
}

async function fetchCryptoNews(symbol: string): Promise<string[]> {
  const apiKey = process.env.NEWS_API_KEY ?? process.env.CRYPTOCOMPARE_API_KEY;
  const url = `${CRYPTOCOMPARE_URL}${apiKey ? `&api_key=${apiKey}` : ''}`;

  // ── Cache hit: raw news items served from Redis RAM ────────────────────
  let items: CryptoCompareNewsItem[] = [];
  const cachedRaw = await newsCacheGet(NEWS_RAW_CACHE_KEY);
  if (cachedRaw) {
    try {
      items = JSON.parse(cachedRaw) as CryptoCompareNewsItem[];
    } catch {
      items = [];
    }
  }

  // ── Cache miss: fetch from CryptoCompare and cache the raw payload ─────
  if (items.length === 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!res.ok) return [];
      const json = (await res.json()) as { Data?: CryptoCompareNewsItem[] };
      items = json?.Data ?? [];
      if (items.length > 0) {
        void newsCacheSet(NEWS_RAW_CACHE_KEY, JSON.stringify(items), NEWS_CACHE_TTL_SECONDS);
      }
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Filter cached/fetched items for this symbol ───────────────────────
  const base = symbol.replace(/USDT$/i, '').toUpperCase();
  const nameMap: Record<string, string> = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binance',
    XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', AVAX: 'avalanche',
    MATIC: 'polygon', DOT: 'polkadot', LINK: 'chainlink', INJ: 'injective',
    SUI: 'sui', APT: 'aptos', ARB: 'arbitrum', OP: 'optimism',
  };
  const searchTerms = [base.toLowerCase(), nameMap[base] ?? ''].filter(Boolean);

  const relevant: string[] = [];
  const general: string[] = [];

  for (const item of items) {
    const title = item.title?.trim() ?? '';
    if (!title) continue;
    const text = `${title} ${item.body ?? ''} ${item.tags ?? ''}`.toLowerCase();
    if (searchTerms.some((t) => text.includes(t))) {
      relevant.push(title);
    } else {
      general.push(title);
    }
  }

  return [...relevant, ...general].slice(0, 12);
}

// ─── Scenario classifier ──────────────────────────────────────────────────

function classifyScenario(
  headlines: string[],
  deltaPct: number,
): { scenario: NewsScenario; sentimentScore: number; macroRiskDetected: boolean } {
  if (headlines.length === 0) {
    // No news + spike → Scenario B (manipulation warning if large spike)
    if (Math.abs(deltaPct) > 5) {
      return { scenario: 'B_MANIPULATION_WARNING', sentimentScore: -0.3, macroRiskDetected: false };
    }
    return { scenario: 'NEUTRAL', sentimentScore: 0, macroRiskDetected: false };
  }

  const combined = headlines.join(' ').toLowerCase();

  // ── Scenario C check: macro/regulatory risk ────────────────────────────
  const macroRiskDetected = MACRO_RISK_PATTERNS.some((p) => p.test(combined));
  if (macroRiskDetected) {
    return { scenario: 'C_PROTECT_CAPITAL', sentimentScore: -0.6, macroRiskDetected: true };
  }

  // ── Score positive / negative keywords ────────────────────────────────
  let positiveHits = 0;
  let negativeHits = 0;
  for (const kw of BULLISH_KEYWORDS) {
    if (combined.includes(kw)) positiveHits++;
  }
  for (const kw of BEARISH_KEYWORDS) {
    if (combined.includes(kw)) negativeHits++;
  }

  const sentimentScore = Math.max(-1, Math.min(1, (positiveHits - negativeHits) / 5));
  const hasSpike = Math.abs(deltaPct) > 3;

  if (hasSpike && sentimentScore > 0.1) {
    return { scenario: 'A_STRONG_BUY', sentimentScore, macroRiskDetected: false };
  }
  if (hasSpike && sentimentScore <= 0.0) {
    return { scenario: 'B_MANIPULATION_WARNING', sentimentScore, macroRiskDetected: false };
  }
  return { scenario: 'NEUTRAL', sentimentScore, macroRiskDetected: false };
}

function scenarioToReasoning(
  scenario: NewsScenario,
  headlines: string[],
  deltaPct: number,
  macroRisk: boolean,
): string {
  const spike = deltaPct.toFixed(2);
  const hl = headlines.slice(0, 3).join('; ') || 'No headlines available';
  switch (scenario) {
    case 'A_STRONG_BUY':
      return `Price spike +${spike}% aligned with positive news catalysts. Top headlines: ${hl}. Scenario A: momentum corroborated — BULLISH.`;
    case 'B_MANIPULATION_WARNING':
      return `Price spike ±${spike}% with no positive news corroboration. Top headlines: ${hl}. Scenario B: likely whale trap or manipulation — BEARISH warning.`;
    case 'C_PROTECT_CAPITAL':
      return `Macro/regulatory risk detected in news stream. Headlines: ${hl}. Scenario C: CEO Overseer triggers PROTECT_CAPITAL — tighten stop-losses.`;
    case 'NEUTRAL':
      return `Insufficient signal correlation. deltaPct=${spike}%. Headlines (sample): ${hl}.`;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Runs the full News Sentinel analysis for a given symbol and delta_pct context.
 * Target latency: < 2 000 ms.
 *
 * @param symbol    e.g. "BTCUSDT"
 * @param deltaPct  Price change context (from whale signal or price feed)
 */
export async function runNewsSentinel(
  symbol: string,
  deltaPct: number,
): Promise<NewsSentinelResult> {
  const t0 = Date.now();

  let headlines: string[] = [];
  try {
    headlines = await fetchCryptoNews(symbol);
  } catch {
    // Non-fatal: proceed with empty headlines → Scenario B/NEUTRAL
  }

  const { scenario, sentimentScore, macroRiskDetected } = classifyScenario(headlines, deltaPct);
  const riskMode: RiskMode = scenario === 'C_PROTECT_CAPITAL' ? 'PROTECT_CAPITAL' : 'NORMAL';
  const reasoning = scenarioToReasoning(scenario, headlines, deltaPct, macroRiskDetected);

  return {
    scenario,
    riskMode,
    sentimentScore,
    topHeadlines: headlines.slice(0, 3),
    macroRiskDetected,
    reasoning,
    latencyMs: Date.now() - t0,
  };
}

/**
 * Maps a NewsSentinelResult to an ExpertResult-compatible verdict.
 * Integrates cleanly into the OrchestratorContext fan-out.
 */
export function newsSentinelToVerdict(
  result: NewsSentinelResult,
): { verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; confidence: number; reasoning: string } {
  switch (result.scenario) {
    case 'A_STRONG_BUY':
      return { verdict: 'BULLISH', confidence: 80, reasoning: result.reasoning };
    case 'B_MANIPULATION_WARNING':
      return { verdict: 'BEARISH', confidence: 75, reasoning: result.reasoning };
    case 'C_PROTECT_CAPITAL':
      return { verdict: 'BEARISH', confidence: 85, reasoning: result.reasoning };
    case 'NEUTRAL':
      return {
        verdict: result.sentimentScore > 0.15 ? 'BULLISH' : result.sentimentScore < -0.15 ? 'BEARISH' : 'NEUTRAL',
        confidence: 50,
        reasoning: result.reasoning,
      };
  }
}
