/**
 * Leviathan — Institutional Whale Context Provider
 *
 * ── DATA SOURCE (Post-Decommission) ───────────────────────────────────────
 * CryptoQuant and CoinMarketCap external APIs have been fully decommissioned.
 * All real-time whale alerts are sovereign via the i9 hardware feed:
 *   Redis Pub/Sub (WHALE_REDIS_URL → "quant:alerts") → BullMQ → Orchestrator
 *
 * This module provides SUPPLEMENTARY per-symbol whale context for AI analysis
 * prompts by using Binance public endpoints only (no API key required):
 *   - aggTrades endpoint: classifies whale-sized order flow
 *   - Ticker endpoint: live price + 24h stats
 *
 * Removed (Operation Clean Slate v2):
 *   ✗  CryptoQuant API  (CRYPTOQUANT_API_KEY)
 *   ✗  CoinMarketCap    (CMC_API_KEY)
 */

import { LEVIATHAN_SPOOFING_BOOK_RULES } from '@/lib/agents/psych-agent';
import { APP_CONFIG } from '@/lib/config';

type LeviathanSignal = {
  provider: 'BinanceAggTrades' | 'BinanceTicker';
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

const BINANCE_WHALE_USD = 100_000;

async function fetchBinanceAggTrades(baseAsset: string): Promise<LeviathanSignal> {
  const symbol = `${baseAsset.toUpperCase()}USDT`;
  const url = `https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=500`;
  const ft = APP_CONFIG.fetchTimeoutMs ?? 12_000;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ft),
    });
    if (!res.ok) {
      return {
        provider: 'BinanceAggTrades',
        ok: false,
        summary: `Binance aggTrades HTTP ${res.status}`,
      };
    }
    const trades = (await res.json()) as Array<{ p: string; q: string; m: boolean }>;

    let buyUsd = 0;
    let sellUsd = 0;
    let largestUsd = 0;
    let whaleCount = 0;

    for (const t of trades) {
      const price = parseFloat(t.p);
      const qty = parseFloat(t.q);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
      const tradeUsd = price * qty;
      if (tradeUsd < BINANCE_WHALE_USD) continue;
      whaleCount++;
      if (tradeUsd > largestUsd) largestUsd = tradeUsd;
      if (t.m) sellUsd += tradeUsd;
      else buyUsd += tradeUsd;
    }

    const netFlowUsd = buyUsd - sellUsd;
    const totalVol = buyUsd + sellUsd;
    const sellPressure = totalVol > 0 ? sellUsd / totalVol : 0;

    return {
      provider: 'BinanceAggTrades',
      ok: true,
      summary:
        `${whaleCount} whale trades (≥$${(BINANCE_WHALE_USD / 1_000).toFixed(0)}k). ` +
        `Net flow: $${(netFlowUsd / 1_000_000).toFixed(2)}M. ` +
        `Sell pressure: ${(sellPressure * 100).toFixed(1)}%. ` +
        `Largest: $${(largestUsd / 1_000_000).toFixed(2)}M.`,
      details: { whaleCount, netFlowUsd, sellPressure, largestUsd },
    };
  } catch (err) {
    return {
      provider: 'BinanceAggTrades',
      ok: false,
      summary: `BinanceAggTrades error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function fetchBinanceTicker(baseAsset: string): Promise<LeviathanSignal> {
  const symbol = `${baseAsset.toUpperCase()}USDT`;
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
  const ft = APP_CONFIG.fetchTimeoutMs ?? 12_000;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ft),
    });
    if (!res.ok) {
      return {
        provider: 'BinanceTicker',
        ok: false,
        summary: `Binance ticker HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      lastPrice?: string;
      volume?: string;
      quoteVolume?: string;
      priceChangePercent?: string;
    };
    const price = Number(data.lastPrice ?? NaN);
    const volume24h = Number(data.quoteVolume ?? NaN);
    const change24h = Number(data.priceChangePercent ?? NaN);
    if (!Number.isFinite(price)) {
      return {
        provider: 'BinanceTicker',
        ok: false,
        summary: 'Binance ticker returned no valid price',
      };
    }
    return {
      provider: 'BinanceTicker',
      ok: true,
      summary:
        `Price: ${price.toFixed(4)} USDT. ` +
        `24h vol: ${Number.isFinite(volume24h) ? `$${(volume24h / 1_000_000).toFixed(1)}M` : 'N/A'}. ` +
        `24h change: ${Number.isFinite(change24h) ? `${change24h.toFixed(2)}%` : 'N/A'}.`,
      details: { price, volume24h, change24h },
    };
  } catch (err) {
    return {
      provider: 'BinanceTicker',
      ok: false,
      summary: `BinanceTicker error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function getLeviathanSnapshot(symbol: string): Promise<LeviathanSnapshot> {
  const cleanSymbol = sanitizeSymbol(symbol);
  const baseAsset = cleanSymbol.endsWith('USDT') ? cleanSymbol.slice(0, -4) : cleanSymbol;
  const [aggTrades, ticker] = await Promise.all([
    fetchBinanceAggTrades(baseAsset),
    fetchBinanceTicker(baseAsset),
  ]);

  const institutionalWhaleContext =
    `Leviathan feed for ${baseAsset} (Binance public data — sovereign i9 pipeline active): ` +
    `[AggTrades] ${aggTrades.summary} ` +
    `[Ticker] ${ticker.summary} ` +
    `Anti-spoofing mandate: ${LEVIATHAN_SPOOFING_BOOK_RULES}`;

  return {
    symbol: cleanSymbol,
    generatedAt: new Date().toISOString(),
    signals: [aggTrades, ticker],
    institutionalWhaleContext,
  };
}
