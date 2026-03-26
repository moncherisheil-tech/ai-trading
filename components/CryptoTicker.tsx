'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatPriceForSymbol } from '@/lib/decimal';
import { useBinanceTicker } from '@/hooks/use-binance-ticker';

export default function CryptoTicker() {
  const { tickers, connectionState } = useBinanceTicker();

  return (
    <div className="relative z-[1] w-full shrink-0 bg-[var(--app-surface)] border-b border-[var(--app-border)] overflow-hidden py-2" id="crypto-ticker" role="region" aria-label="זרם מחירי קריפטו">
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
                      <span className="font-mono text-sm text-white tabular-nums">${formatPriceForSymbol(ticker.price, ticker.symbol)}</span>
                      <span className={`flex items-center text-xs font-semibold tabular-nums ${ticker.change >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
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
