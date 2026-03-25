import { LEVIATHAN_SPOOFING_BOOK_RULES } from '@/lib/agents/psych-agent';

type LeviathanSignal = {
  provider: 'CryptoQuant' | 'CoinMarketCap';
  ok: boolean;
  summary: string;
  details?: Record<string, unknown>;
};

export type LeviathanSnapshot = {
  symbol: string;
  generatedAt: string;
  signals: LeviathanSignal[];
  institutionalWhaleContext: string;
};

function sanitizeSymbol(symbol: string): string {
  return (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function fetchCoinMarketCapQuote(baseAsset: string): Promise<LeviathanSignal> {
  const apiKey = (process.env.CMC_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[Leviathan] Missing API key: CMC_API_KEY');
    return {
      provider: 'CoinMarketCap',
      ok: false,
      summary: 'Missing API Key (CMC_API_KEY)',
    };
  }

  const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(baseAsset)}&convert=USD`;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'X-CMC_PRO_API_KEY': apiKey,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        provider: 'CoinMarketCap',
        ok: false,
        summary: `CoinMarketCap request failed (${res.status})`,
        details: { body: body.slice(0, 220) },
      };
    }
    const payload = (await res.json()) as {
      data?: Record<string, { quote?: { USD?: { price?: number; volume_24h?: number; percent_change_24h?: number } } }>;
    };
    const quote = payload?.data?.[baseAsset]?.quote?.USD;
    const price = Number(quote?.price ?? NaN);
    const volume24h = Number(quote?.volume_24h ?? NaN);
    const change24h = Number(quote?.percent_change_24h ?? NaN);
    if (!Number.isFinite(price)) {
      return {
        provider: 'CoinMarketCap',
        ok: false,
        summary: 'CoinMarketCap returned no valid quote',
      };
    }
    return {
      provider: 'CoinMarketCap',
      ok: true,
      summary: `CMC price=${price.toFixed(2)} USD, 24h vol=${Number.isFinite(volume24h) ? volume24h.toFixed(0) : 'N/A'}, 24h change=${Number.isFinite(change24h) ? change24h.toFixed(2) : 'N/A'}%`,
      details: { price, volume24h, change24h },
    };
  } catch (error) {
    return {
      provider: 'CoinMarketCap',
      ok: false,
      summary: `CoinMarketCap error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function fetchCryptoQuantSignals(baseAsset: string): Promise<LeviathanSignal> {
  const apiKey = (process.env.CRYPTOQUANT_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[Leviathan] Missing API key: CRYPTOQUANT_API_KEY');
    return {
      provider: 'CryptoQuant',
      ok: false,
      summary: 'Missing API Key (CRYPTOQUANT_API_KEY)',
    };
  }

  const asset = baseAsset.toLowerCase();
  const netflowUrl = `https://api.cryptoquant.com/v1/${asset}/exchange-flows/netflow`;
  const whaleUrl = `https://api.cryptoquant.com/v1/${asset}/flow-indicator/whale-ratio`;
  try {
    const [netflowRes, whaleRes] = await Promise.all([
      fetch(netflowUrl, { cache: 'no-store', headers: { Authorization: `Bearer ${apiKey}` } }),
      fetch(whaleUrl, { cache: 'no-store', headers: { Authorization: `Bearer ${apiKey}` } }),
    ]);

    const netflowBody = netflowRes.ok ? await netflowRes.json().catch(() => null) : await netflowRes.text().catch(() => '');
    const whaleBody = whaleRes.ok ? await whaleRes.json().catch(() => null) : await whaleRes.text().catch(() => '');

    const netflowOk = netflowRes.ok;
    const whaleOk = whaleRes.ok;
    if (!netflowOk && !whaleOk) {
      return {
        provider: 'CryptoQuant',
        ok: false,
        summary: `CryptoQuant requests failed (netflow=${netflowRes.status}, whale=${whaleRes.status})`,
        details: {
          netflowBody: typeof netflowBody === 'string' ? netflowBody.slice(0, 180) : netflowBody,
          whaleBody: typeof whaleBody === 'string' ? whaleBody.slice(0, 180) : whaleBody,
        },
      };
    }

    const netflowPreview = netflowOk ? JSON.stringify(netflowBody).slice(0, 140) : `status=${netflowRes.status}`;
    const whalePreview = whaleOk ? JSON.stringify(whaleBody).slice(0, 140) : `status=${whaleRes.status}`;
    return {
      provider: 'CryptoQuant',
      ok: true,
      summary: `CQ netflow=${netflowPreview}; whaleRatio=${whalePreview}`,
      details: { netflow: netflowBody, whaleRatio: whaleBody },
    };
  } catch (error) {
    return {
      provider: 'CryptoQuant',
      ok: false,
      summary: `CryptoQuant error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function getLeviathanSnapshot(symbol: string): Promise<LeviathanSnapshot> {
  const cleanSymbol = sanitizeSymbol(symbol);
  const baseAsset = cleanSymbol.endsWith('USDT') ? cleanSymbol.slice(0, -4) : cleanSymbol;
  const [cryptoQuant, coinMarketCap] = await Promise.all([
    fetchCryptoQuantSignals(baseAsset),
    fetchCoinMarketCapQuote(baseAsset),
  ]);

  const institutionalWhaleContext =
    `Leviathan feed for ${baseAsset}: ` +
    `${cryptoQuant.provider}: ${cryptoQuant.summary}. ` +
    `${coinMarketCap.provider}: ${coinMarketCap.summary}. ` +
    `Anti-spoofing mandate: ${LEVIATHAN_SPOOFING_BOOK_RULES}`;

  return {
    symbol: cleanSymbol,
    generatedAt: new Date().toISOString(),
    signals: [cryptoQuant, coinMarketCap],
    institutionalWhaleContext,
  };
}
