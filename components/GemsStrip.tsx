'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, Gem } from 'lucide-react';
import type { Ticker24h } from '@/lib/gem-finder';

export default function GemsStrip() {
  const [tickers, setTickers] = useState<Ticker24h[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/crypto/gems');
        if (!res.ok) return;
        const data = (await res.json()) as Ticker24h[];
        if (!cancelled) setTickers(data.slice(0, 12));
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (loading || tickers.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="border-b border-zinc-800 bg-zinc-900/80 py-3 px-4"
      aria-label="מטבעות ג'מס — נפח 24 שעות"
    >
      <div className="max-w-7xl mx-auto flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-500/90 font-semibold">
          <Gem className="w-3.5 h-3.5" />
          ג'מס
        </span>
        {tickers.map((t, i) => {
          const base = t.symbol.replace('USDT', '');
          const up = t.priceChangePercent >= 0;
          return (
            <motion.div
              key={t.symbol}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/60"
            >
              <span className="font-semibold text-zinc-200 text-xs">{base}</span>
              <span className="font-mono text-zinc-400 text-[11px]">
                ${t.price >= 10 ? t.price.toFixed(2) : t.price.toFixed(4)}
              </span>
              <span className={`flex items-center text-[10px] font-semibold ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(t.priceChangePercent).toFixed(2)}%
              </span>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}
