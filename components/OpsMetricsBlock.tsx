'use client';

import { useEffect, useState, memo } from 'react';
import { motion } from 'motion/react';
import { getT } from '@/lib/i18n';
import { Skeleton } from '@/components/ui/Skeleton';
import { getOpsMetricsAction } from '@/app/actions';

const t = getT('he');

type Metrics = {
  db: { total: number; pending: number; evaluated: number };
  quality: { avgLatencyMs: number; fallbackUsed: number; repaired: number };
  audit: { warnings: number; errors: number };
  accuracy?: {
    fromHistorical: boolean;
    winRatePct: number | null;
    avgErrorPct: number | null;
    last10WinRatePct: number | null;
    prev10WinRatePct: number | null;
  };
} | null;

function hasMetricsShape(data: Metrics): data is Exclude<Metrics, null> {
  return !!data && typeof data.db === 'object' && typeof data.quality === 'object' && typeof data.audit === 'object';
}

/** 8s timeout per fetch (aligned with Vercel Hobby); cleanup in finally prevents memory leaks. */
const METRICS_FETCH_TIMEOUT_MS = 8000;

function OpsMetricsBlockInner() {
  const [metrics, setMetrics] = useState<Metrics>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), METRICS_FETCH_TIMEOUT_MS);
    });

    void (async () => {
      try {
        const out = await Promise.race([getOpsMetricsAction(), timeout]);
        if (cancelled) return;
        if (out === null) {
          setMetrics(null);
          setFetchFailed(true);
          setUnauthorized(false);
          return;
        }

        if (!out.success) {
          if (out.error === 'UNAUTHORIZED') {
            setUnauthorized(true);
            setMetrics(null);
            setFetchFailed(false);
            return;
          }
          setMetrics(null);
          setFetchFailed(true);
          setUnauthorized(false);
          return;
        }

        const data = out.data as Metrics;
        if (hasMetricsShape(data)) {
          setMetrics(data);
          setFetchFailed(false);
          setUnauthorized(false);
        } else {
          setMetrics(null);
          setFetchFailed(true);
        }
      } catch {
        if (!cancelled) {
          setMetrics(null);
          setFetchFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-4"
        dir="rtl"
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-4">
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-4">
              <Skeleton className="h-3 w-24 mb-2" />
              <Skeleton className="h-8 w-14" />
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  if (unauthorized) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300" role="alert">
        {t.unauthorizedRequest}
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-800/80 p-4 text-sm text-amber-400">
        {fetchFailed
          ? 'זמן הטעינה פג. אנא רענן את הדף'
          : t.failedToLoadMetrics}
      </div>
    );
  }

  const db = metrics?.db ?? { total: 0, pending: 0, evaluated: 0 };
  const quality = metrics?.quality ?? { avgLatencyMs: 0, fallbackUsed: 0, repaired: 0 };
  const audit = metrics?.audit ?? { warnings: 0, errors: 0 };
  const accuracy = metrics?.accuracy;
  const last10 = accuracy?.last10WinRatePct ?? null;
  const prev10 = accuracy?.prev10WinRatePct ?? null;
  const improving = last10 != null && prev10 != null && last10 > prev10;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-0 overflow-hidden">
        <div className="rounded-xl bg-black/40 frosted-obsidian p-4 overflow-hidden transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95">
          <div className="text-xs text-zinc-400">{t.totalPredictions}</div>
          <div className="text-2xl font-semibold text-zinc-100">{db.total}</div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-4 overflow-hidden transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95">
          <div className="text-xs text-zinc-400">{t.pending}</div>
          <div className="text-2xl font-semibold text-amber-400">{db.pending}</div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-4 overflow-hidden transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95">
          <div className="text-xs text-zinc-400">{t.evaluated}</div>
          <div className="text-2xl font-semibold text-emerald-400">{db.evaluated}</div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-4 overflow-hidden transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95">
          <div className="text-xs text-zinc-400">{t.avgLatency}</div>
          <div className="text-2xl font-semibold text-zinc-100">{quality.avgLatencyMs} ms</div>
        </div>
      </div>
      {accuracy?.fromHistorical && (accuracy.winRatePct != null || accuracy.avgErrorPct != null || last10 != null || prev10 != null) && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3">דיוק ממומש (מתחזיות שהוערכו)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div className="rounded-lg bg-zinc-800/80 p-3">
              <div className="text-[10px] text-zinc-500">אחוז הצלחה</div>
              <div className="text-xl font-semibold text-zinc-100">
                {accuracy.winRatePct != null ? `${accuracy.winRatePct}%` : '—'}
              </div>
            </div>
            <div className="rounded-lg bg-zinc-800/80 p-3">
              <div className="text-[10px] text-zinc-500">{t.avgErrorLabel}</div>
              <div className="text-xl font-semibold text-zinc-100">
                {accuracy.avgErrorPct != null ? `${accuracy.avgErrorPct}%` : '—'}
              </div>
            </div>
          </div>
          {(last10 != null || prev10 != null) && (
            <div className={`text-sm font-medium rounded-lg px-3 py-2 ${improving ? 'bg-emerald-500/20 text-emerald-300' : last10 != null && prev10 != null && last10 < prev10 ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-700/50 text-zinc-300'}`}>
              <span className="text-zinc-500">מגמת דיוק: </span>
              10 אחרונות: <strong>{last10 != null ? `${last10}%` : '—'}</strong>
              {' | '}
              10 קודמות: <strong>{prev10 != null ? `${prev10}%` : '—'}</strong>
              {improving && ' ↑ משתפר'}
              {last10 != null && prev10 != null && last10 < prev10 && ' ↓'}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-0 overflow-hidden">
        <div className="rounded-xl bg-black/40 frosted-obsidian p-4 overflow-hidden transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95">
          <div className="text-xs text-zinc-400">מודל גיבוי</div>
          <div className="text-2xl font-semibold text-zinc-100">{quality.fallbackUsed}</div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-4 overflow-hidden transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95">
          <div className="text-xs text-zinc-400">תיקון ולידציה</div>
          <div className="text-2xl font-semibold text-zinc-100">{quality.repaired}</div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-4 overflow-hidden transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95">
          <div className="text-xs text-zinc-400">אזהרות ביקורת</div>
          <div className="text-2xl font-semibold text-amber-400">{audit.warnings}</div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-4 overflow-hidden transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95">
          <div className="text-xs text-zinc-400">שגיאות ביקורת</div>
          <div className="text-2xl font-semibold text-red-400">{audit.errors}</div>
        </div>
      </div>
    </motion.div>
  );
}

export default memo(OpsMetricsBlockInner);
