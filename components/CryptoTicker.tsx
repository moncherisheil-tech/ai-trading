'use client';

import { memo, useMemo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatPriceForSymbol } from '@/lib/decimal';
import { useBinanceTicker } from '@/hooks/use-binance-ticker';
import type { TickerData } from '@/hooks/use-binance-ticker';

/** Single coin cell — pure CSS scroll handles motion, only text reconciles here. */
const TickerItem = memo(function TickerItem({ ticker }: { ticker: TickerData }) {
  const up = ticker.change >= 0;
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap border-e border-white/5 px-5">
      <span className="text-[11px] font-bold text-zinc-100">{ticker.symbol}</span>
      <span className="ticker-numeric text-[11px] text-zinc-300">
        ${formatPriceForSymbol(ticker.price, ticker.symbol)}
      </span>
      <span
        className={`ticker-numeric flex items-center gap-0.5 text-[10px] font-semibold ${
          up ? 'text-emerald-400' : 'text-red-400'
        }`}
      >
        {up ? (
          <TrendingUp className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <TrendingDown className="h-2.5 w-2.5 shrink-0" />
        )}
        {up ? '+' : ''}
        {ticker.change.toFixed(2)}%
      </span>
    </div>
  );
});

/** One scrolling band — reuses existing pure-CSS ticker-loop animation. */
function TickerBand({
  items,
  duration,
  ariaLabel,
}: {
  items: TickerData[];
  duration: string;
  ariaLabel: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="ticker-marquee min-w-0 flex-1" aria-live="polite" aria-label={ariaLabel}>
      <div
        className="ticker-loop"
        style={{ '--ticker-duration': duration } as React.CSSProperties}
      >
        {[0, 1].map((copyIdx) => (
          <div className="ticker-track" aria-hidden={copyIdx === 1} key={copyIdx}>
            {items.map((t) => (
              <TickerItem key={`${t.symbol}-${copyIdx}`} ticker={t} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Dual-Band Ticker Matrix
 *
 * Top band  (green) — Top Gainers sorted by % change descending.
 * Bottom band (red) — Top Losers  sorted by % change ascending (most negative first).
 *
 * Motion is handled entirely by the CSS `ticker-scroll` keyframe animation on `.ticker-loop`
 * with a per-band `--ticker-duration` var that scales with item count.
 * No React state intervals, no JS timers for animation — zero render-loop overhead.
 *
 * Wrapped in React.memo — prevents re-renders triggered by unrelated parent state updates.
 */
const CryptoTicker = memo(function CryptoTicker() {
  const { tickers, connectionState } = useBinanceTicker();

  const gainers = useMemo(
    () => [...tickers].filter((t) => t.change >= 0).sort((a, b) => b.change - a.change),
    [tickers]
  );
  const losers = useMemo(
    () => [...tickers].filter((t) => t.change < 0).sort((a, b) => a.change - b.change),
    [tickers]
  );

  // If no losers yet (e.g. bull market), use the worst performers from gainers as the bottom band.
  const topBand = gainers.length > 0 ? gainers : tickers;
  const bottomBand = losers.length > 0 ? losers : gainers.slice(Math.ceil(gainers.length / 2));

  // ~2 s/item keeps coins readable; clamp to a sane range.
  const topDuration = `${Math.min(Math.max(topBand.length * 2, 30), 110)}s`;
  const btmDuration = `${Math.min(Math.max(bottomBand.length * 2, 26), 100)}s`;

  const connDot =
    connectionState === 'connected'
      ? 'bg-emerald-400'
      : connectionState === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-rose-500';

  const connLabel =
    connectionState === 'connected'
      ? `LIVE · ${tickers.length}`
      : connectionState === 'connecting'
        ? 'CONNECTING'
        : 'RECONNECTING';

  return (
    <div
      className="relative z-[1] w-full shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface)]"
      id="crypto-ticker"
      role="region"
      aria-label="מטריצת מחירי קריפטו — דו-ערוצי"
    >
      {/* ── Status bar ── */}
      <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-1">
        <span className={`h-1.5 w-1.5 rounded-full ${connDot}`} />
        <span className="text-[9px] uppercase tracking-widest text-zinc-500">{connLabel}</span>
      </div>

      {tickers.length === 0 ? (
        <div className="animate-pulse px-4 py-2 text-xs text-zinc-500">טוען זרם שוק...</div>
      ) : (
        <div>
          {/* ── Band 1: Top Gainers (green accent) ── */}
          <div className="flex items-center border-t border-emerald-500/10 bg-gradient-to-r from-emerald-950/25 via-transparent to-transparent py-1">
            <div className="flex w-[4.5rem] shrink-0 items-center justify-end pr-2">
              <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500/60">
                ▲ GAIN
              </span>
            </div>
            <TickerBand items={topBand} duration={topDuration} ariaLabel="מובילי עלייה" />
          </div>

          {/* ── Band 2: Top Losers (red accent) ── */}
          <div className="flex items-center border-t border-red-500/10 bg-gradient-to-r from-red-950/25 via-transparent to-transparent py-1">
            <div className="flex w-[4.5rem] shrink-0 items-center justify-end pr-2">
              <span className="text-[8px] font-black uppercase tracking-widest text-red-500/60">
                ▼ LOSS
              </span>
            </div>
            <TickerBand items={bottomBand} duration={btmDuration} ariaLabel="מובילי ירידה" />
          </div>
        </div>
      )}
    </div>
  );
});

export default CryptoTicker;
