'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_CONFIG, TARGET_SYMBOLS } from '@/lib/config';

type ConnectionState = 'connecting' | 'connected' | 'error' | 'stale';

export interface TickerData {
  symbol: string;
  price: number;
  change: number;
}

type TickerSnapshot = {
  tickers: TickerData[];
  connectionState: ConnectionState;
  usdtUsdcPrice?: number;
  usdtUsdcDeltaPct?: number;
  usdtUsdcUpdatedAtMs?: number;
};

type TickerSubscriber = (snapshot: TickerSnapshot) => void;
const RECONNECT_DELAY_MS = 5_000;
const FLUSH_MS = 180;
/** If no message arrives within this window while connected, mark connection as stale and force reconnect. */
const STALE_THRESHOLD_MS = 10_000;
/** Hard reconnect every N ms regardless of stale detection — guards against silent feed freezes. */
const HARD_RECONNECT_INTERVAL_MS = 5 * 60_000; // 5 minutes

// ─── Dynamic Top-20 Symbol Registry ──────────────────────────────────────────
// Populated on first subscriber attach via Binance REST 24hr ticker endpoint.
// Falls back to TARGET_SYMBOLS (full static list) until the fetch resolves.

let dynamicSymbols: string[] | null = null;
let symbolFetchPromise: Promise<void> | null = null;

async function fetchTop20ByVolume(): Promise<void> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Binance 24hr ticker fetch failed: ${res.status}`);
    const data = (await res.json()) as Array<{ symbol: string; quoteVolume: string }>;
    const top20 = data
      .filter((t) => typeof t.symbol === 'string' && t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 20)
      .map((t) => t.symbol.toUpperCase());
    dynamicSymbols = top20;
    console.log(`[use-binance-ticker] Dynamic Top 20 USDT pairs by volume loaded: ${top20.join(', ')}`);
  } catch (err) {
    console.error('[use-binance-ticker] Top-20 fetch failed — using full static symbol list as fallback:', err);
    // Non-fatal: fall back to the full TARGET_SYMBOLS list so the ticker still renders
    dynamicSymbols = null;
  }
}

/** Returns the active symbol list: dynamic top-20 if fetched, full static list otherwise. */
function getActiveSymbols(): readonly string[] {
  return dynamicSymbols ?? TARGET_SYMBOLS;
}

// ─── Module-level singleton WebSocket state ───────────────────────────────────

function detachWebSocketHandlers(socket: WebSocket): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
}

let globalWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let staleTimer: ReturnType<typeof setTimeout> | null = null;
let hardReconnectTimer: ReturnType<typeof setInterval> | null = null;
let lastMessageAtMs = 0;
let pendingRows: Array<{ s?: string; c?: string; o?: string }> | null = null;
let snapshot: TickerSnapshot = { tickers: [], connectionState: 'connecting' };
const subscribers = new Set<TickerSubscriber>();

function emitSnapshot(): void {
  for (const subscriber of subscribers) subscriber(snapshot);
}

function setSnapshot(partial: Partial<TickerSnapshot>): void {
  snapshot = { ...snapshot, ...partial };
  emitSnapshot();
}

function resetStaleTimer(): void {
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
  if (subscribers.size === 0) return;
  staleTimer = setTimeout(() => {
    staleTimer = null;
    const msSinceMsg = Date.now() - lastMessageAtMs;
    if (msSinceMsg >= STALE_THRESHOLD_MS && snapshot.connectionState === 'connected') {
      console.warn(`[use-binance-ticker] No message in ${msSinceMsg}ms — marking connection as stale and forcing reconnect.`);
      setSnapshot({ connectionState: 'stale' });
      const sock = globalWs;
      globalWs = null;
      if (sock) {
        detachWebSocketHandlers(sock);
        if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) sock.close();
      }
      scheduleReconnect();
    }
  }, STALE_THRESHOLD_MS);
}

function flushPendingRows(): void {
  const rows = pendingRows;
  pendingRows = null;
  if (!rows || rows.length === 0) return;

  // Map-based deduplication: symbol is the key — mathematically impossible to produce duplicates.
  const map = new Map(snapshot.tickers.map((ticker) => [ticker.symbol, ticker]));

  let validPriceCount = 0;
  rows.forEach((row) => {
    const price = parseFloat(String(row.c ?? ''));
    const open = parseFloat(String(row.o ?? ''));
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(open) || open <= 0) {
      const sym = String(row.s ?? '');
      if (sym) console.warn(`[use-binance-ticker] Zero/invalid price for ${sym} — skipping row.`);
      return;
    }
    validPriceCount++;
    const baseSymbol = String(row.s ?? '').replace(/USDT$/i, '');
    const change = ((price - open) / open) * 100;
    // setSnapshot via Map.set guarantees uniqueness — identical baseSymbol overwrites previous entry
    map.set(baseSymbol, { symbol: baseSymbol, price, change });
  });

  if (validPriceCount === 0 && rows.length > 0) {
    console.warn('[use-binance-ticker] Flush batch contained no valid prices — possible feed issue.');
  }

  // Re-order output to match the active symbol list (volume-sorted top 20 or full static list)
  const activeSymbols = getActiveSymbols();
  const ordered = activeSymbols
    .map((symbol) => symbol.replace(/USDT$/i, ''))
    .map((base) => map.get(base))
    .filter((row): row is TickerData => row != null);

  if (ordered.length > 0) setSnapshot({ tickers: ordered });
}

function updateUsdtUsdcProxy(row: { c?: string; o?: string } | null): void {
  if (!row) return;
  const price = parseFloat(String(row.c ?? ''));
  const open = parseFloat(String(row.o ?? ''));
  if (!Number.isFinite(price) || price <= 0) return;
  const delta = Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : undefined;
  setSnapshot({
    usdtUsdcPrice: price,
    usdtUsdcDeltaPct: delta,
    usdtUsdcUpdatedAtMs: Date.now(),
  });
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPendingRows();
  }, FLUSH_MS);
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureConnected();
  }, RECONNECT_DELAY_MS);
}

function startHardReconnectInterval(): void {
  if (hardReconnectTimer) return;
  hardReconnectTimer = setInterval(() => {
    if (subscribers.size === 0) return;
    const msSinceMsg = Date.now() - lastMessageAtMs;
    if (msSinceMsg >= HARD_RECONNECT_INTERVAL_MS) {
      console.warn(`[use-binance-ticker] Hard reconnect triggered — no message in ${Math.round(msSinceMsg / 1000)}s.`);
      const sock = globalWs;
      globalWs = null;
      if (sock) {
        detachWebSocketHandlers(sock);
        if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) sock.close();
      }
      setSnapshot({ connectionState: 'connecting' });
      ensureConnected();
    }
  }, HARD_RECONNECT_INTERVAL_MS);
}

function stopHardReconnectInterval(): void {
  if (hardReconnectTimer) {
    clearInterval(hardReconnectTimer);
    hardReconnectTimer = null;
  }
}

function ensureConnected(): void {
  if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) return;
  setSnapshot({ connectionState: 'connecting' });
  startHardReconnectInterval();
  const ws = new WebSocket(APP_CONFIG.tickerSocketUrl);
  globalWs = ws;

  ws.onopen = () => {
    lastMessageAtMs = Date.now();
    setSnapshot({ connectionState: 'connected' });
    resetStaleTimer();
  };

  ws.onmessage = (event) => {
    lastMessageAtMs = Date.now();
    resetStaleTimer();
    let data: unknown;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!Array.isArray(data)) return;

    const usdtUsdcRow = data.find((t: { s?: string }) => String(t.s || '').toUpperCase() === 'USDTUSDC') as
      | { c?: string; o?: string }
      | undefined;
    updateUsdtUsdcProxy(usdtUsdcRow ?? null);

    // Filter to active symbol set — strict Set-lookup for O(1) dedup gate at the ingestion boundary
    const activeSet = new Set(getActiveSymbols());
    const filtered = data.filter((t: { s?: string }) => activeSet.has(String(t.s || '').toUpperCase()));
    if (filtered.length === 0) return;
    pendingRows = filtered;
    scheduleFlush();
  };

  ws.onerror = () => setSnapshot({ connectionState: 'error' });

  ws.onclose = () => {
    const closed = globalWs;
    globalWs = null;
    if (closed) detachWebSocketHandlers(closed);
    if (staleTimer) { clearTimeout(staleTimer); staleTimer = null; }
    setSnapshot({ connectionState: 'error' });
    if (subscribers.size > 0) scheduleReconnect();
  };
}

function subscribeTicker(subscriber: TickerSubscriber): () => void {
  subscribers.add(subscriber);
  // Emit the current snapshot immediately so the UI is never blank on subscribe
  subscriber(snapshot);

  // Kick off the top-20 volume fetch on first subscriber.
  // Promise is cached — subsequent subscribers share the same single in-flight request.
  if (!symbolFetchPromise) {
    symbolFetchPromise = fetchTop20ByVolume();
  }

  ensureConnected();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size > 0) return;

    // Last subscriber left — fully tear down the singleton
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (staleTimer) { clearTimeout(staleTimer); staleTimer = null; }
    stopHardReconnectInterval();
    pendingRows = null;

    // Reset dynamic symbol registry so the next mount re-fetches fresh top-20 data
    dynamicSymbols = null;
    symbolFetchPromise = null;

    const sock = globalWs;
    globalWs = null;
    if (sock) {
      detachWebSocketHandlers(sock);
      if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) {
        sock.close();
      }
    }
    snapshot = { ...snapshot, connectionState: 'connecting' };
  };
}

export function useBinanceTicker() {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [usdtUsdcPrice, setUsdtUsdcPrice] = useState<number | undefined>(undefined);
  const [usdtUsdcDeltaPct, setUsdtUsdcDeltaPct] = useState<number | undefined>(undefined);
  const [usdtUsdcUpdatedAtMs, setUsdtUsdcUpdatedAtMs] = useState<number | undefined>(undefined);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback(() => {
    unsubscribeRef.current = subscribeTicker((next) => {
      setTickers(next.tickers);
      setConnectionState(next.connectionState);
      setUsdtUsdcPrice(next.usdtUsdcPrice);
      setUsdtUsdcDeltaPct(next.usdtUsdcDeltaPct);
      setUsdtUsdcUpdatedAtMs(next.usdtUsdcUpdatedAtMs);
    });
  }, []);

  useEffect(() => {
    subscribe();
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [subscribe]);

  return { tickers, connectionState, usdtUsdcPrice, usdtUsdcDeltaPct, usdtUsdcUpdatedAtMs };
}
