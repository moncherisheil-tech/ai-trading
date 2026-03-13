'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { getT } from '@/lib/i18n';

const t = getT('he');

type Metrics = {
  db: { total: number; pending: number; evaluated: number };
  quality: { avgLatencyMs: number; fallbackUsed: number; repaired: number };
  audit: { warnings: number; errors: number };
} | null;

/** 8s timeout per fetch (aligned with Vercel Hobby); cleanup in finally prevents memory leaks. */
const METRICS_FETCH_TIMEOUT_MS = 8000;

export default function OpsMetricsBlock() {
  const [metrics, setMetrics] = useState<Metrics>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), METRICS_FETCH_TIMEOUT_MS);

    fetch('/api/ops/metrics', { cache: 'no-store', signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) return null;
        try {
          return await r.json();
        } catch {
          return null;
        }
      })
      .then((data) => {
        setMetrics(data && typeof data?.db === 'object' ? data : null);
        setFetchFailed(false);
      })
      .catch(() => {
        setMetrics(null);
        setFetchFailed(true);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        setLoading(false);
      });

    return () => clearTimeout(timeoutId);
  }, []);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-6 flex items-center justify-center gap-3 min-h-[120px]"
      >
        <div className="h-4 w-4 rounded-full border-2 border-amber-500/60 border-t-amber-400 animate-spin" aria-hidden />
        <span className="text-sm text-zinc-400">{t.loadingHistorical}</span>
      </motion.div>
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/80 p-4 bg-gradient-to-br from-zinc-800 to-zinc-800/50">
          <div className="text-xs text-zinc-400">{t.totalPredictions}</div>
          <div className="text-2xl font-semibold text-zinc-100">{db.total}</div>
        </div>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/80 p-4 bg-gradient-to-br from-zinc-800 to-zinc-800/50">
          <div className="text-xs text-zinc-400">{t.pending}</div>
          <div className="text-2xl font-semibold text-amber-400">{db.pending}</div>
        </div>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/80 p-4 bg-gradient-to-br from-zinc-800 to-zinc-800/50">
          <div className="text-xs text-zinc-400">{t.evaluated}</div>
          <div className="text-2xl font-semibold text-emerald-400">{db.evaluated}</div>
        </div>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/80 p-4 bg-gradient-to-br from-zinc-800 to-zinc-800/50">
          <div className="text-xs text-zinc-400">{t.avgLatency}</div>
          <div className="text-2xl font-semibold text-zinc-100">{quality.avgLatencyMs} ms</div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/80 p-4 bg-gradient-to-br from-zinc-800 to-zinc-800/50">
          <div className="text-xs text-zinc-400">מודל גיבוי</div>
          <div className="text-2xl font-semibold text-zinc-100">{quality.fallbackUsed}</div>
        </div>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/80 p-4 bg-gradient-to-br from-zinc-800 to-zinc-800/50">
          <div className="text-xs text-zinc-400">תיקון ולידציה</div>
          <div className="text-2xl font-semibold text-zinc-100">{quality.repaired}</div>
        </div>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/80 p-4 bg-gradient-to-br from-zinc-800 to-zinc-800/50">
          <div className="text-xs text-zinc-400">אזהרות ביקורת</div>
          <div className="text-2xl font-semibold text-amber-400">{audit.warnings}</div>
        </div>
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/80 p-4 bg-gradient-to-br from-zinc-800 to-zinc-800/50">
          <div className="text-xs text-zinc-400">שגיאות ביקורת</div>
          <div className="text-2xl font-semibold text-red-400">{audit.errors}</div>
        </div>
      </div>
    </motion.div>
  );
}
