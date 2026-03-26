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

export function useBinanceTicker() {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRowsRef = useRef<any[] | null>(null);
  const closedByUnmountRef = useRef(false);

  const flushPendingRows = useCallback(() => {
    const rows = pendingRowsRef.current;
    pendingRowsRef.current = null;
    if (!rows || rows.length === 0) return;

    setTickers((prev) => {
      const map = new Map(prev.map((ticker) => [ticker.symbol, ticker]));
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
      return ordered.length > 0 ? ordered : prev;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (updateTimerRef.current) return;
    updateTimerRef.current = setTimeout(() => {
      updateTimerRef.current = null;
      flushPendingRows();
    }, 120);
  }, [flushPendingRows]);

  const clearReconnectTimer = useCallback(() => {
    if (!reconnectTimerRef.current) return;
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const connect = useCallback(() => {
    if (closedByUnmountRef.current) return;
    clearReconnectTimer();
    wsRef.current?.close();
    setConnectionState('connecting');

    const ws = new WebSocket(APP_CONFIG.tickerSocketUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      setConnectionState('connected');
    };

    ws.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!Array.isArray(data)) return;

      const filtered = data.filter((t: { s?: string }) =>
        TARGET_SYMBOLS.includes((t.s || '').toUpperCase())
      );
      if (filtered.length === 0) return;
      pendingRowsRef.current = filtered;
      scheduleFlush();
    };

    ws.onerror = () => {
      setConnectionState('error');
    };

    ws.onclose = () => {
      if (closedByUnmountRef.current) return;
      setConnectionState('error');
      const nextAttempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = nextAttempt;
      if (nextAttempt > MAX_RETRIES) return;

      const expDelay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (nextAttempt - 1));
      const jitter = Math.floor(Math.random() * Math.min(700, Math.floor(expDelay * 0.2)));
      reconnectTimerRef.current = setTimeout(connect, expDelay + jitter);
    };
  }, [clearReconnectTimer, scheduleFlush]);

  useEffect(() => {
    closedByUnmountRef.current = false;
    connect();
    return () => {
      closedByUnmountRef.current = true;
      clearReconnectTimer();
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [clearReconnectTimer, connect]);

  return { tickers, connectionState };
}
