'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_CONFIG, TARGET_SYMBOLS } from '@/lib/config';

type ConnectionState = 'connecting' | 'connected' | 'error';

export interface TickerData {
  symbol: string;
  price: number;
  change: number;
}

type TickerSnapshot = {
  tickers: TickerData[];
  connectionState: ConnectionState;
};

type TickerSubscriber = (snapshot: TickerSnapshot) => void;
const RECONNECT_DELAY_MS = 5_000;
let globalWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
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

function flushPendingRows(): void {
  const rows = pendingRows;
  pendingRows = null;
  if (!rows || rows.length === 0) return;
  const map = new Map(snapshot.tickers.map((ticker) => [ticker.symbol, ticker]));
  rows.forEach((row) => {
    const price = parseFloat(String(row.c ?? ''));
    const open = parseFloat(String(row.o ?? ''));
    if (!Number.isFinite(price) || !Number.isFinite(open) || open <= 0) return;
    const baseSymbol = String(row.s ?? '').replace('USDT', '');
    const change = ((price - open) / open) * 100;
    map.set(baseSymbol, { symbol: baseSymbol, price, change });
  });
  const ordered = TARGET_SYMBOLS
    .map((symbol) => symbol.replace('USDT', ''))
    .map((base) => map.get(base))
    .filter((row): row is TickerData => row != null);
  if (ordered.length > 0) setSnapshot({ tickers: ordered });
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPendingRows();
  }, 120);
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureConnected();
  }, RECONNECT_DELAY_MS);
}

function ensureConnected(): void {
  if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) return;
  setSnapshot({ connectionState: 'connecting' });
  const ws = new WebSocket(APP_CONFIG.tickerSocketUrl);
  globalWs = ws;

  ws.onopen = () => {
    setSnapshot({ connectionState: 'connected' });
  };

  ws.onmessage = (event) => {
    let data: unknown;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!Array.isArray(data)) return;
    const filtered = data.filter((t: { s?: string }) => TARGET_SYMBOLS.includes(String(t.s || '').toUpperCase()));
    if (filtered.length === 0) return;
    pendingRows = filtered;
    scheduleFlush();
  };

  ws.onerror = () => setSnapshot({ connectionState: 'error' });
  ws.onclose = () => {
    globalWs = null;
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
    pendingRows = null;
    if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) {
      globalWs.close();
    }
    globalWs = null;
    snapshot = { ...snapshot, connectionState: 'connecting' };
  };
}

export function useBinanceTicker() {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback(() => {
    unsubscribeRef.current = subscribeTicker((next) => {
      setTickers(next.tickers);
      setConnectionState(next.connectionState);
    });
  }, []);

  useEffect(() => {
    subscribe();
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [subscribe]);

  return { tickers, connectionState };
}
