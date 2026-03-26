'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_CONFIG, TARGET_SYMBOLS } from '@/lib/config';

type ConnectionState = 'connecting' | 'connected' | 'error';

export interface TickerData {
  symbol: string;
  price: number;
  change: number;
}

const MAX_BACKOFF_MS = Math.max(APP_CONFIG.tickerReconnectMaxMs, 5_000);
const BASE_BACKOFF_MS = Math.max(APP_CONFIG.tickerReconnectBaseMs, 400);
const MAX_RETRIES = 100;

type TickerSnapshot = {
  tickers: TickerData[];
  connectionState: ConnectionState;
};

type TickerSubscriber = (snapshot: TickerSnapshot) => void;

class BinanceTickerSingleton {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private pendingRows: any[] | null = null;
  private subscribers = new Set<TickerSubscriber>();
  private snapshot: TickerSnapshot = { tickers: [], connectionState: 'connecting' };

  subscribe(subscriber: TickerSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.snapshot);
    if (this.subscribers.size === 1) this.connect();
    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) this.teardown();
    };
  }

  private emit() {
    for (const subscriber of this.subscribers) subscriber(this.snapshot);
  }

  private setState(partial: Partial<TickerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    this.emit();
  }

  private flushPendingRows = () => {
    const rows = this.pendingRows;
    this.pendingRows = null;
    if (!rows || rows.length === 0) return;
    const map = new Map(this.snapshot.tickers.map((ticker) => [ticker.symbol, ticker]));
    rows.forEach((row) => {
      const price = parseFloat(row.c);
      const open = parseFloat(row.o);
      if (!Number.isFinite(price) || !Number.isFinite(open) || open <= 0) return;
      const baseSymbol = String(row.s).replace('USDT', '');
      const change = ((price - open) / open) * 100;
      map.set(baseSymbol, { symbol: baseSymbol, price, change });
    });
    const ordered = TARGET_SYMBOLS
      .map((symbol) => symbol.replace('USDT', ''))
      .map((base) => map.get(base))
      .filter((row): row is TickerData => row != null);
    if (ordered.length > 0) this.setState({ tickers: ordered });
  };

  private scheduleFlush() {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.flushPendingRows();
    }, 120);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private connect = () => {
    this.clearReconnectTimer();
    this.ws?.close();
    this.setState({ connectionState: 'connecting' });
    const ws = new WebSocket(APP_CONFIG.tickerSocketUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState({ connectionState: 'connected' });
    };

    ws.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!Array.isArray(data)) return;
      const filtered = data.filter((t: { s?: string }) => TARGET_SYMBOLS.includes((t.s || '').toUpperCase()));
      if (filtered.length === 0) return;
      this.pendingRows = filtered;
      this.scheduleFlush();
    };

    ws.onerror = () => {
      this.setState({ connectionState: 'error' });
    };

    ws.onclose = () => {
      if (this.subscribers.size === 0) return;
      this.setState({ connectionState: 'error' });
      const nextAttempt = this.reconnectAttempt + 1;
      this.reconnectAttempt = nextAttempt;
      if (nextAttempt > MAX_RETRIES) return;
      const expDelay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (nextAttempt - 1));
      const jitter = Math.floor(Math.random() * Math.min(700, Math.floor(expDelay * 0.2)));
      this.reconnectTimer = setTimeout(this.connect, expDelay + jitter);
    };
  };

  private teardown() {
    this.clearReconnectTimer();
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
    this.ws?.close();
    this.ws = null;
    this.pendingRows = null;
    this.reconnectAttempt = 0;
    this.snapshot = { ...this.snapshot, connectionState: 'connecting' };
  }
}

const globalTickerKey = '__QMC_BINANCE_TICKER_SINGLETON__';
const globalScope = globalThis as typeof globalThis & {
  [globalTickerKey]?: BinanceTickerSingleton;
};
const tickerSingleton = globalScope[globalTickerKey] ?? new BinanceTickerSingleton();
globalScope[globalTickerKey] = tickerSingleton;

export function useBinanceTicker() {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const subscribe = useCallback(() => {
    unsubscribeRef.current = tickerSingleton.subscribe((snapshot) => {
      setTickers(snapshot.tickers);
      setConnectionState(snapshot.connectionState);
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
