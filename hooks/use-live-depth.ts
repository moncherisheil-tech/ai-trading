'use client';

import { useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface L2Level {
  price: number;
  qty: number;
}

export interface L2Snapshot {
  symbol: string;
  /** Sorted descending by price (best bid first) */
  bids: L2Level[];
  /** Sorted ascending by price (best ask first) */
  asks: L2Level[];
  ts: number;
}

// Symbols that the HFT Redis feed actually publishes
const HFT_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT']);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalise a raw order-book side that may arrive as either:
 *   - Array-of-arrays:  [[price, qty], ...]
 *   - Array-of-objects: [{price, qty}, ...]
 *   - Array-of-strings: ["price", "qty"] (some Binance-compatible feeds)
 */
function normaliseLevels(raw: unknown): L2Level[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((item): L2Level | null => {
      if (Array.isArray(item) && item.length >= 2) {
        const price = parseFloat(String(item[0]));
        const qty = parseFloat(String(item[1]));
        return Number.isFinite(price) && Number.isFinite(qty) ? { price, qty } : null;
      }
      if (item !== null && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const price = parseFloat(String(o.price ?? o.p ?? ''));
        const qty = parseFloat(String(o.qty ?? o.q ?? o.size ?? ''));
        return Number.isFinite(price) && Number.isFinite(qty) ? { price, qty } : null;
      }
      return null;
    })
    .filter((l): l is L2Level => l !== null);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useLiveDepth — consumes the SSE depth stream from /api/stream/depth.
 *
 * @param symbol  Full trading pair, e.g. "BTCUSDT". Pass null/undefined to
 *                disable the stream.
 *
 * Only `BTCUSDT` and `ETHUSDT` are currently broadcast by the HFT engine;
 * for any other symbol the hook returns `{ depth: null, connected: false }`
 * without opening a connection.
 */
export function useLiveDepth(symbol: string | null | undefined): {
  depth: L2Snapshot | null;
  connected: boolean;
} {
  const [depth, setDepth] = useState<L2Snapshot | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!symbol || !HFT_SYMBOLS.has(symbol)) {
      setDepth(null);
      setConnected(false);
      return;
    }

    const url = `/api/stream/depth?symbol=${encodeURIComponent(symbol)}`;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);

    es.onerror = () => {
      setConnected(false);
      // EventSource will auto-reconnect; no manual action needed here.
    };

    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as Record<string, unknown>;

        // Skip the internal "connected" confirmation frame
        if (parsed.type === 'connected') return;

        const snapshot: L2Snapshot = {
          symbol: typeof parsed.symbol === 'string' ? parsed.symbol : symbol,
          bids: normaliseLevels(parsed.bids),
          asks: normaliseLevels(parsed.asks),
          ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now(),
        };

        setDepth(snapshot);
      } catch {
        // Ignore malformed frames
      }
    };

    return () => {
      setConnected(false);
      es.close();
    };
  }, [symbol]);

  return { depth, connected };
}
