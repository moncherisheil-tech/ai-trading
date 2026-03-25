/**
 * News Agent: fetches crypto headlines from CryptoCompare and produces a market
 * sentiment score for use in the prediction and learning loops.
 * Set NEWS_API_KEY or CRYPTOCOMPARE_API_KEY in .env for CryptoCompare API access.
 */

import { ANTHROPIC_HAIKU_MODEL } from '@/lib/anthropic-model';

const CRYPTOCOMPARE_NEWS_URL = 'https://min-api.cryptocompare.com/data/v2/news/';
const DEFAULT_HEADLINES_LIMIT = 12;

export interface SentimentResult {
  score: number; // -1 (bearish) to 1 (bullish)
  narrative: string;
}

export type SentimentGuardrailStatus = 'EXTREME_FEAR' | 'EXTREME_GREED' | 'NORMAL';

/**
 * Sentiment Guardrail for risk management: flags extreme market mood
 * so that confidence can be penalized and alerts sent (e.g. Telegram).
 */
export function checkSentimentGuardrail(score: number): SentimentGuardrailStatus {
  if (score <= -0.8) return 'EXTREME_FEAR';
  if (score >= 0.8) return 'EXTREME_GREED';
  return 'NORMAL';
}

function getNewsApiKey(): string | undefined {
  return process.env.NEWS_API_KEY ?? process.env.CRYPTOCOMPARE_API_KEY;
}

/**
 * Map symbol to search terms for filtering headlines (e.g. BTCUSDT -> BTC, Bitcoin).
 */
function symbolToSearchTerms(symbol: string): string[] {
  const base = symbol.replace(/USDT$/i, '').toUpperCase();
  const terms = [base];
  const known: Record<string, string> = {
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    BNB: 'Binance',
    SOL: 'Solana',
    XRP: 'Ripple',
    DOGE: 'Dogecoin',
    ADA: 'Cardano',
    AVAX: 'Avalanche',
    DOT: 'Polkadot',
    MATIC: 'Polygon',
    LINK: 'Chainlink',
    UNI: 'Uniswap',
    ATOM: 'Cosmos',
    LTC: 'Litecoin',
    BCH: 'Bitcoin Cash',
    ETC: 'Ethereum Classic',
    XLM: 'Stellar',
    ALGO: 'Algorand',
    VET: 'VeChain',
    FIL: 'Filecoin',
    TRX: 'Tron',
    NEAR: 'NEAR Protocol',
    APT: 'Aptos',
    ARB: 'Arbitrum',
    OP: 'Optimism',
    INJ: 'Injective',
    SUI: 'Sui',
    SEI: 'Sei',
    PEPE: 'Pepe',
    WIF: 'dogwifhat',
    FET: 'Fetch.ai',
    RENDER: 'Render',
    GRT: 'The Graph',
    AAVE: 'Aave',
    MKR: 'Maker',
    SNX: 'Synthetix',
    CRV: 'Curve',
    COMP: 'Compound',
    SAND: 'Sandbox',
    MANA: 'Decentraland',
    AXS: 'Axie Infinity',
    GALA: 'Gala',
    APE: 'ApeCoin',
    SHIB: 'Shiba Inu',
    FLOKI: 'Floki',
  };
  if (known[base]) terms.push(known[base]);
  return terms;
}

/**
 * Fetch latest crypto news headlines from CryptoCompare.
 * Uses NEWS_API_KEY from .env when set (recommended for higher rate limits).
 * Falls back to generic crypto feed if symbol-specific filtering yields little.
 */
export async function fetchLatestCryptoNews(symbol: string): Promise<string[]> {
  const apiKey = getNewsApiKey();
  const limit = DEFAULT_HEADLINES_LIMIT;
  const url = `${CRYPTOCOMPARE_NEWS_URL}?lang=EN&limit=15${apiKey ? `&api_key=${apiKey}` : ''}`;

  let data: { Data?: Array<{ title?: string; body?: string }> };
  try {
    const res = await fetch(url, { cache: 'no-store', next: { revalidate: 0 } });
    if (!res.ok) return [];
    data = (await res.json()) as typeof data;
  } catch {
    return [];
  }

  const items = data?.Data ?? [];
  const terms = symbolToSearchTerms(symbol);
  const headlines: string[] = [];

  for (const item of items) {
    const title = item.title ?? '';
    const bodySnippet = typeof item.body === 'string' ? item.body.slice(0, 200) : '';
    const text = `${title} ${bodySnippet}`.toLowerCase();
    const matches = terms.some((t) => text.includes(t.toLowerCase()));
    if (matches) headlines.push(title || bodySnippet || '');
  }

  // If too few symbol-specific, use general headlines up to limit
  if (headlines.length < 5) {
    for (const item of items.slice(0, limit)) {
      if (headlines.length >= limit) break;
      const title = item.title ?? '';
      if (title && !headlines.includes(title)) headlines.push(title);
    }
  } else {
    headlines.splice(limit);
  }

  return headlines.filter(Boolean);
}

function getClaudeApiKey(): string {
  const key = process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Claude API key missing. Set CLAUDE_API_KEY or ANTHROPIC_API_KEY.');
  return key;
}

/**
 * Get market sentiment from headlines using Claude 3.5 Sonnet.
 * Returns a score in [-1, 1] and a short narrative.
 */
export async function getMarketSentiment(symbol: string): Promise<SentimentResult> {
  const headlines = await fetchLatestCryptoNews(symbol);
  const fallback: SentimentResult = { score: 0, narrative: 'No headlines available; sentiment neutral.' };

  if (!headlines.length) return fallback;

  const apiKey = getClaudeApiKey();
  const prompt = `You are a crypto market sentiment analyst. Given the following recent headlines for ${symbol}, output ONLY a JSON object with two keys:
- "score": a number between -1 and 1, where -1 = strong fear/panic/bearish, 0 = neutral, 1 = strong greed/FOMO/bullish.
- "narrative": a single short sentence (in English) summarizing the dominant market mood and why.

Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Respond with ONLY valid JSON, no markdown or extra text. Example: {"score": 0.3, "narrative": "Mixed sentiment with slight bullish bias on institutional news."}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_HAIKU_MODEL,
        max_tokens: 256,
        temperature: 0.1,
        system: 'You output only valid JSON. No explanation, no code block wrapper.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return fallback;
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = json?.content?.[0]?.text?.trim();
    if (!text) return fallback;

    const parsed = JSON.parse(text) as { score?: number; narrative?: string };
    const score = typeof parsed.score === 'number'
      ? Math.max(-1, Math.min(1, parsed.score))
      : 0;
    const narrative = typeof parsed.narrative === 'string' ? parsed.narrative : fallback.narrative;
    return { score, narrative };
  } catch {
    return fallback;
  }
}
