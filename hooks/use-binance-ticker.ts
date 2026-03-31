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
    const baseSymbol = String(row.s ?? '').replace('USDT', '');
    const change = ((price - open) / open) * 100;
    map.set(baseSymbol, { symbol: baseSymbol, price, change });
  });
  if (validPriceCount === 0 && rows.length > 0) {
    console.warn('[use-binance-ticker] Flush batch contained no valid prices — possible feed issue.');
  }
  const ordered = TARGET_SYMBOLS
    .map((symbol) => symbol.replace('USDT', ''))
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
    const filtered = data.filter((t: { s?: string }) => TARGET_SYMBOLS.includes(String(t.s || '').toUpperCase()));
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
  subscriber(snapshot);
  ensureConnected();
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size > 0) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
    stopHardReconnectInterval();
    pendingRows = null;
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
