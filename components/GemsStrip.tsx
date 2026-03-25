'use client';

import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Gem } from 'lucide-react';
import type { Ticker24h, SignalStrength } from '@/lib/gem-finder';
import { formatPriceForSymbol } from '@/lib/decimal';
import { useRefreshIntervalMs } from '@/context/AppSettingsContext';

export default function GemsStrip() {
  const refreshIntervalMs = useRefreshIntervalMs();
  const [tickers, setTickers] = useState<Ticker24h[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/crypto/gems');
        if (!res.ok) return;
        const data = (await res.json()) as Ticker24h[];
        if (cancelled) return;
        const nextRows = data.slice(0, 12);
        if (nextRows.length === 0) return;
        setTickers((prev) => {
          if (prev.length === 0) return nextRows;
          const bySymbol = new Map(nextRows.map((row) => [row.symbol, row]));
          const merged = prev.map((row) => bySymbol.get(row.symbol) ?? row);
          const missing = nextRows.filter((row) => !merged.some((m) => m.symbol === row.symbol));
          return [...merged, ...missing].slice(0, 12);
        });
        setReady(true);
      } catch {
        // ignore
      }
    };

    void load();
    const t = setInterval(() => void load(), refreshIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [refreshIntervalMs]);

  const displayTickers = useMemo(() => tickers, [tickers]);

  if (!ready || tickers.length === 0) return null;

  return (
    <section
      className="border-b border-[var(--app-border)] bg-[var(--app-surface)] py-2 px-4 overflow-hidden"
      aria-label="מטבעות ג'מס — נפח 24 שעות"
    >
      <div className="max-w-7xl mx-auto flex items-center gap-3 min-w-0">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-500 font-semibold shrink-0">
          <Gem className="w-3.5 h-3.5" />
          ג&apos;מס
        </span>
        <div className="market-marquee">
          <div className="market-marquee-loop">
            {[0, 1].map((copyIndex) => (
              <div className="market-marquee-track" aria-hidden={copyIndex === 1} key={copyIndex}>
                {displayTickers.map((t, i) => {
                  const base = t.symbol.replace('USDT', '');
                  const up = t.priceChangePercent >= 0;
                  const strength: SignalStrength = t.signalStrength ?? 'low';
                  const strengthLabel = strength === 'high' ? 'חזק' : strength === 'medium' ? 'בינוני' : 'חלש';
                  return (
                    <div
                      key={`${t.symbol}-${i}-copy-${copyIndex}`}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--ui-radius-lg)] bg-white/[0.02] border border-white/5 text-zinc-100 whitespace-nowrap shrink-0"
                      aria-label={`${base} נפח 24h, שינוי ${t.priceChangePercent.toFixed(2)}%, עוצמת איתות ${strengthLabel}`}
                    >
                      <span className="font-semibold text-white text-xs">{base}</span>
                      <span className="font-mono text-zinc-500 text-[11px]">
                        ${formatPriceForSymbol(t.price, t.symbol)}
                      </span>
                      <span className={`flex items-center text-[10px] font-semibold ${up ? 'text-emerald-400' : 'text-rose-500'}`}>
                        {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {Math.abs(t.priceChangePercent).toFixed(2)}%
                      </span>
                      {strength !== 'low' && (
                        <span
                          title={`עוצמת איתות: ${strengthLabel} (נפח + שינוי מחיר)`}
                          className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                            strength === 'high' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-600/50 text-zinc-400'
                          }`}
                        >
                          {strengthLabel}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
