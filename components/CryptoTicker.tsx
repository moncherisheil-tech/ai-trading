'use client';

import { useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { APP_CONFIG, TARGET_SYMBOLS } from '@/lib/config';

interface TickerData {
  symbol: string;
  price: number;
  change: number;
}

type ConnectionState = 'connecting' | 'connected' | 'error';

export default function CryptoTicker() {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRowsRef = useRef<any[] | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closedByUnmount = false;

    const flushPendingRows = () => {
      const rows = pendingRowsRef.current;
      pendingRowsRef.current = null;
      if (!rows || rows.length === 0) return;

      setTickers((prev) => {
        const map = new Map(prev.map((ticker) => [ticker.symbol, ticker]));
        rows.forEach((row) => {
          const price = parseFloat(row.c);
          const open = parseFloat(row.o);
          if (!Number.isFinite(price) || !Number.isFinite(open) || open <= 0) {
            return;
          }

          const baseSymbol = String(row.s).replace('USDT', '');
          const change = ((price - open) / open) * 100;
          map.set(baseSymbol, { symbol: baseSymbol, price, change });
        });

        return Array.from(map.values());
      });
    };

    const scheduleFlush = () => {
      if (updateTimerRef.current) return;
      updateTimerRef.current = setTimeout(() => {
        updateTimerRef.current = null;
        flushPendingRows();
      }, 120);
    };

    const connect = () => {
      setConnectionState('connecting');
      ws = new WebSocket(APP_CONFIG.tickerSocketUrl);

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');
      };

      ws.onmessage = (event) => {
        const data: unknown = JSON.parse(event.data);
        if (!Array.isArray(data)) return;

        const filtered = data.filter((t: any) => TARGET_SYMBOLS.includes(t.s));
        if (filtered.length === 0) return;

        pendingRowsRef.current = filtered;
        scheduleFlush();
      };

      ws.onerror = () => {
        setConnectionState('error');
      };

      ws.onclose = () => {
        if (closedByUnmount) return;
        setConnectionState('error');
        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay = Math.min(APP_CONFIG.tickerReconnectMaxMs, APP_CONFIG.tickerReconnectBaseMs * attempt);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
      ws?.close();
    };
  }, []);

  // Duplicate for seamless scroll
  const displayTickers = [...tickers, ...tickers];

  return (
    <div className="w-full bg-slate-900 border-b border-slate-800 overflow-hidden py-2" id="crypto-ticker" role="region" aria-label="Crypto ticker stream">
      <div className="px-4 pb-1 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-emerald-400' : connectionState === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-400'}`} />
        <span className="text-[10px] uppercase tracking-wider text-slate-400">
          {connectionState === 'connected' ? 'live' : connectionState === 'connecting' ? 'connecting' : 'reconnecting'}
        </span>
      </div>

      {displayTickers.length === 0 ? (
        <div className="px-4 py-1 text-xs text-slate-400 animate-pulse">Loading market stream...</div>
      ) : (
      <div className="ticker-track">
        {displayTickers.map((ticker, i) => (
          <div key={`${ticker.symbol}-${i}`} className="flex items-center gap-2 px-6 border-r border-slate-800 last:border-0 whitespace-nowrap">
            <span className="font-bold text-slate-300 text-sm">{ticker.symbol}</span>
            <span className="font-mono text-white text-sm">${ticker.price >= 10 ? ticker.price.toFixed(2) : ticker.price.toFixed(4)}</span>
            <span className={`flex items-center text-xs font-semibold ${ticker.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {ticker.change >= 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
              {Math.abs(ticker.change).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
