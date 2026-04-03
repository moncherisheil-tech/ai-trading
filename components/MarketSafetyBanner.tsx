'use client';

import { Shield, AlertTriangle } from 'lucide-react';
import { useMarketState } from '@/context/MarketStateContext';

const SAFE_LABEL = 'שוק יציב — תנאים אופטימליים';
const DANGER_LABEL = 'אזהרת סיכון: תנודתיות גבוהה — מומלץ להימנע ממסחר';

/**
 * Reads market risk data from the shared MarketStateContext instead of issuing
 * its own fetch. Previously this component sent an independent GET /api/market/risk
 * on every mount, duplicating the request already fired by MarketStateProvider
 * (which polls every 18 s). Consuming the context eliminates the duplicate
 * round-trip and cuts initial page-load latency by ~1–10 s.
 */
export default function MarketSafetyBanner() {
  const { sentiment, loading } = useMarketState();

  if (loading || !sentiment) {
    return (
      <div
        className="w-full py-2.5 px-4 bg-zinc-800/80 border-b border-white/5 text-center text-sm text-zinc-400"
        dir="rtl"
        aria-label="טוען סטטוס בטיחות שוק"
      >
        <span className="cyber-decrypt text-[11px] font-semibold tracking-[0.2em]" data-scramble="RISK-CHECK-72">
          MARKET RISK SCAN
        </span>
      </div>
    );
  }

  const isSafe = sentiment.status === 'SAFE';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full py-3 px-4 sm:px-6 border-b flex items-center justify-center gap-2 flex-wrap text-sm sm:text-base font-semibold min-h-[44px] ${
        isSafe
          ? 'bg-emerald-950/80 border-b border-emerald-500/30 text-emerald-100'
          : 'bg-rose-950/80 border-b border-rose-500/30 text-rose-100'
      }`}
      dir="rtl"
    >
      {isSafe ? (
        <Shield className="w-4 h-4 shrink-0 text-emerald-400 animate-pulse" aria-hidden />
      ) : (
        <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 animate-pulse" aria-hidden />
      )}
      <span>{isSafe ? SAFE_LABEL : DANGER_LABEL}</span>
      {sentiment.reasoning && (
        <span className="text-xs opacity-90 font-normal max-w-2xl truncate" title={sentiment.reasoning}>
          ({sentiment.reasoning})
        </span>
      )}
    </div>
  );
}
