'use client';

import { memo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatPriceForSymbol } from '@/lib/decimal';
import { useBinanceTicker } from '@/hooks/use-binance-ticker';
import type { TickerData } from '@/hooks/use-binance-ticker';

/** One row of live data; horizontal motion is pure CSS on `.ticker-loop` — only text updates reconcile here. */
const TickerItemRow = memo(function TickerItemRow({ ticker }: { ticker: TickerData }) {
  const up = ticker.change >= 0;
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap border-e border-white/5 px-6">
      <span className="text-sm font-bold text-zinc-100">{ticker.symbol}</span>
      <span className="ticker-numeric text-sm text-white">
        ${formatPriceForSymbol(ticker.price, ticker.symbol)}
      </span>
      <span
        className={`ticker-numeric flex items-center text-xs font-semibold ${
          up ? 'text-emerald-500' : 'text-red-400/75'
        }`}
      >
        {up ? <TrendingUp className="me-0.5 h-3 w-3 shrink-0" /> : <TrendingDown className="me-0.5 h-3 w-3 shrink-0" />}
        {Math.abs(ticker.change).toFixed(2)}%
      </span>
    </div>
  );
});

export default function CryptoTicker() {
  const { tickers, connectionState } = useBinanceTicker();

  // Scale scroll speed with item count: ~2 s/item so all coins are readable.
  // Minimum 40 s; maximum 120 s (safety clamp for very large lists).
  const tickerDuration = `${Math.min(Math.max(tickers.length * 2, 40), 120)}s`;

  return (
    <div
      className="relative z-[1] w-full shrink-0 bg-[var(--app-surface)] border-b border-[var(--app-border)] overflow-hidden py-2"
      id="crypto-ticker"
      role="region"
      aria-label="זרם מחירי קריפטו"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="pb-1 flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${connectionState === 'connected' ? 'bg-emerald-400' : connectionState === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'}`}
          />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            {connectionState === 'connected'
              ? `חי · ${tickers.length} מטבעות`
              : connectionState === 'connecting'
                ? 'מתחבר'
                : 'מתחבר מחדש'}
          </span>
        </div>

        {tickers.length === 0 ? (
          <div className="py-1 text-xs text-zinc-500 animate-pulse min-h-7">טוען זרם שוק...</div>
        ) : (
          <div className="ticker-marquee" aria-live="polite">
            {/* --ticker-duration scales the CSS animation to the live item count */}
            <div
              className="ticker-loop"
              style={{ '--ticker-duration': tickerDuration } as React.CSSProperties}
            >
              {[0, 1].map((copyIndex) => (
                <div className="ticker-track" aria-hidden={copyIndex === 1} key={copyIndex}>
                  {tickers.map((ticker) => (
                    <TickerItemRow key={`${ticker.symbol}-${copyIndex}`} ticker={ticker} />
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
