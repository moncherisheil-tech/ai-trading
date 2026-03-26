'use client';

import { useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { APP_CONFIG, TARGET_SYMBOLS } from '@/lib/config';
import { formatPriceForSymbol } from '@/lib/decimal';

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
        const ordered = TARGET_SYMBOLS
          .map((symbol) => symbol.replace('USDT', ''))
          .map((base) => map.get(base))
          .filter((row): row is TickerData => row != null);
        return ordered.length > 0 ? ordered : prev;
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
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!Array.isArray(data)) return;

        const filtered = data.filter((t: { s?: string }) => TARGET_SYMBOLS.includes((t.s || '').toUpperCase()));
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

  return (
    <div className="relative z-40 w-full bg-[var(--app-surface)] border-b border-[var(--app-border)] overflow-hidden py-2" id="crypto-ticker" role="region" aria-label="זרם מחירי קריפטו">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="pb-1 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-emerald-400' : connectionState === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'}`} />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            {connectionState === 'connected' ? 'חי' : connectionState === 'connecting' ? 'מתחבר' : 'מתחבר מחדש'}
          </span>
        </div>

        {tickers.length === 0 ? (
          <div className="py-1 text-xs text-zinc-500 animate-pulse min-h-7">טוען זרם שוק...</div>
        ) : (
          <div className="ticker-marquee" aria-live="polite">
            <div className="ticker-loop">
              {[0, 1].map((copyIndex) => (
                <div className="ticker-track" aria-hidden={copyIndex === 1} key={copyIndex}>
                  {tickers.map((ticker) => (
                    <div key={`${ticker.symbol}-${copyIndex}`} className="flex shrink-0 items-center gap-2 whitespace-nowrap border-e border-white/5 px-6">
                      <span className="text-sm font-bold text-zinc-100">{ticker.symbol}</span>
                      <span className="font-mono text-sm text-white">${formatPriceForSymbol(ticker.price, ticker.symbol)}</span>
                      <span className={`flex items-center text-xs font-semibold ${ticker.change >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                        {ticker.change >= 0 ? <TrendingUp className="me-0.5 h-3 w-3" /> : <TrendingDown className="me-0.5 h-3 w-3" />}
                        {Math.abs(ticker.change).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
