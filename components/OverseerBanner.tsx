'use client';

import { useState, useEffect } from 'react';
import { Activity, RefreshCw } from 'lucide-react';

export interface OverseerContextPayload {
  globalExposurePct: number;
  todayPnlPct: number;
  currentMoeThreshold: number;
  recentWinRatePct: number;
  openPositionsCount: number;
  closedPositionsCount: number;
  marketUncertaintyFlag: boolean;
  statusHe: string;
  /** From settings: used for UI exposure red/amber (e.g. red when >= this). */
  maxExposurePct?: number;
  /** From settings: used for concentration warning. */
  maxConcentrationPct?: number;
}

export default function OverseerBanner() {
  const [context, setContext] = useState<OverseerContextPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContext = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/overseer/context', { credentials: 'include' });
      if (!res.ok) {
        setContext(null);
        setError('טעינה נכשלה');
        return;
      }
      const data = await res.json();
      setContext(data);
    } catch {
      setContext(null);
      setError('שגיאת רשת');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch('/api/overseer/context', { credentials: 'include' });
        if (cancelled) return;
        if (!res.ok) {
          setContext(null);
          setError('טעינה נכשלה');
          return;
        }
        const data = await res.json();
        if (!cancelled) setContext(data);
      } catch {
        if (!cancelled) { setContext(null); setError('שגיאת רשת'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    setError(null);
    run();
    const interval = setInterval(run, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading && !context) {
    return (
      <div
        className="rounded-xl border border-cyan-900/50 bg-[#030f1c]/95 p-4 flex items-center gap-3"
        dir="rtl"
        aria-label="מפקח עליון — טוען"
      >
        <Activity className="w-5 h-5 text-cyan-400 animate-pulse" />
        <span className="text-cyan-200/80 text-sm">טוען הערכת בריאות מערכת…</span>
      </div>
    );
  }

  if (error && !context) {
    return (
      <div
        className="rounded-xl border border-amber-900/50 bg-[#0f1c03]/80 p-4 flex items-center justify-between gap-3"
        dir="rtl"
      >
        <span className="text-amber-200/90 text-sm">{error}</span>
        <button
          type="button"
          onClick={fetchContext}
          className="p-1.5 rounded-lg bg-cyan-900/40 text-cyan-300 hover:bg-cyan-800/50 transition-colors"
          aria-label="רענן"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const c = context!;
  const pnlSign = c.todayPnlPct >= 0 ? '+' : '';
  const exposureRed = c.maxExposurePct ?? 70;
  const exposureAmber = Math.min(exposureRed - 1, 50);
  const exposureLevel =
    c.globalExposurePct >= exposureRed ? 'text-red-400' : c.globalExposurePct >= exposureAmber ? 'text-amber-400' : 'text-cyan-400';

  return (
    <div
      className="rounded-xl border border-cyan-900/50 bg-[#030f1c]/95 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4"
      dir="rtl"
      aria-label="הערכת בריאות — מפקח עליון"
    >
      <div className="flex items-center gap-2">
        <Activity className="w-6 h-6 text-cyan-400 shrink-0" aria-hidden />
        <div>
          <p className="text-cyan-50 font-semibold text-sm">מפקח עליון (Virtual COO)</p>
          <p className="text-cyan-200/80 text-xs mt-0.5">{c.statusHe}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm min-w-0">
        <span className="text-cyan-200/90">
          חשיפה גלובלית: <span className={exposureLevel} dir="ltr">{c.globalExposurePct.toFixed(1)}%</span>
        </span>
        <span className="text-cyan-200/90">
          PnL יומי: <span className={c.todayPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'} dir="ltr">{pnlSign}{c.todayPnlPct.toFixed(2)}%</span>
        </span>
        <span className="text-cyan-200/90">סף MoE: <span dir="ltr">{c.currentMoeThreshold}</span></span>
        <span className="text-cyan-200/90">אחוז הצלחה: <span dir="ltr">{c.recentWinRatePct.toFixed(1)}%</span></span>
        <span className="text-cyan-200/90">
          פוזיציות: <span dir="ltr">{c.openPositionsCount}</span> פתוחות / <span dir="ltr">{c.closedPositionsCount}</span> סגורות
        </span>
      </div>
      <button
        type="button"
        onClick={fetchContext}
        className="p-2 rounded-lg bg-cyan-900/30 text-cyan-400 hover:bg-cyan-800/50 transition-colors"
        aria-label="רענן הערכת בריאות"
      >
        <RefreshCw className="w-4 h-4" />
      </button>
    </div>
  );
}
