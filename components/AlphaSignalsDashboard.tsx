'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, X, Zap } from 'lucide-react';
import type { AlphaSignalDTO } from '@/lib/alpha-signals-db';
import { useToastOptional } from '@/context/ToastContext';
import {
  executeTradingSignalAction,
  generateAlphaMatrixAction,
  getLatestAlphaSignalsAction,
} from '@/app/actions';

type ExecutePayload = {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    status: 'executed' | 'blocked' | 'skipped' | 'failed';
    reason: string;
    signal: 'BUY' | 'SELL' | null;
    executed: boolean;
  };
};

const TOP_SCAN = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'] as const;

function timeframeLabel(tf: string): string {
  switch (tf) {
    case 'Hourly':
      return 'שעתי';
    case 'Daily':
      return 'יומי';
    case 'Weekly':
      return 'שבועי';
    case 'Long':
      return 'ארוך טווח';
    default:
      return 'אופק לא מוכר';
  }
}

function directionLabel(d: string): string {
  return d === 'Short' ? 'שורט' : 'לונג';
}

function probBarGradient(p: number): string {
  if (p >= 70) return 'linear-gradient(90deg, #facc15, #22c55e)';
  if (p >= 45) return 'linear-gradient(90deg, #eab308, #84cc16)';
  return 'linear-gradient(90deg, #f97316, #ef4444)';
}

function ProbabilityBar({ value }: { value: number }) {
  const p = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${p}%`, background: probBarGradient(p) }}
        />
      </div>
      <p className="mt-1 text-center text-xs font-semibold tabular-nums text-zinc-200">{p}%</p>
    </div>
  );
}

export default function AlphaSignalsDashboard() {
  const toast = useToastOptional();
  const [rows, setRows] = useState<AlphaSignalDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanSymbol, setScanSymbol] = useState<(typeof TOP_SCAN)[number]>('BTCUSDT');
  const [godTier, setGodTier] = useState(false);
  const [pendingExecution, setPendingExecution] = useState<{
    row: AlphaSignalDTO;
    side: 'BUY' | 'SELL';
  } | null>(null);
  const [submittingExecution, setSubmittingExecution] = useState(false);
  const [execKey, setExecKey] = useState<Record<string, 'idle' | 'processing' | 'executed' | 'blocked'>>({});

  const loadSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await getLatestAlphaSignalsAction();
      if (!out.success) {
        throw new Error(out.error);
      }
      setRows(out.data);
      setGodTier(out.data.length > 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בטעינת הנתונים.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSignals();
  }, [loadSignals]);

  const onDeepScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const sym = scanSymbol;
      const out = await generateAlphaMatrixAction(sym);
      if (!out.success) {
        throw new Error(out.error);
      }
      toast?.success('סריקת עומק הושלמה — הנתונים עודכנו במסד הנתונים.');
      await loadSignals();
    } catch (e) {
      toast?.error(e instanceof Error ? e.message : 'סריקת עומק נכשלה.');
    } finally {
      setScanning(false);
    }
  }, [scanSymbol, loadSignals, toast]);

  const openExecute = useCallback(
    (row: AlphaSignalDTO) => {
      const side = row.direction === 'Short' ? 'SELL' : 'BUY';
      const k = `${row.id}`;
      if (execKey[k] === 'processing') return;
      if (execKey[k] === 'executed') {
        toast?.success('בוצע כבר — TWAP פעיל.');
        return;
      }
      setPendingExecution({ row, side });
    },
    [execKey, toast]
  );

  const closeModal = useCallback(() => {
    if (!submittingExecution) setPendingExecution(null);
  }, [submittingExecution]);

  const confirmExecute = useCallback(async () => {
    if (!pendingExecution) return;
    const { row, side } = pendingExecution;
    const k = row.id;
    setSubmittingExecution(true);
    setExecKey((prev) => ({ ...prev, [k]: 'processing' }));
    try {
      const base = row.symbol.replace(/USDT$/i, '');
      const out = await executeTradingSignalAction({
        symbol: base,
        side,
        confidence: row.winProbability,
        priority: 'standard',
        idempotencyKey: `alpha-${row.id}-${Math.floor(Date.now() / 20000)}`,
      });
      if (!out.success) {
        setExecKey((prev) => ({ ...prev, [k]: 'idle' }));
        toast?.error(out.error || 'בקשת ביצוע נכשלה.');
        return;
      }
      const payload = out.data as ExecutePayload;
      const inner = payload.data;
      if (!payload.success || inner?.status === 'blocked') {
        setExecKey((prev) => ({ ...prev, [k]: inner?.status === 'blocked' ? 'blocked' : 'idle' }));
        toast?.error(payload.error || inner?.reason || 'חסום או נכשל.');
        return;
      }
      setExecKey((prev) => ({ ...prev, [k]: 'executed' }));
      toast?.success('האות נשלח למרכז הפיקוד לביצוע TWAP.');
    } catch (err) {
      setExecKey((prev) => ({ ...prev, [k]: 'idle' }));
      toast?.error(err instanceof Error ? err.message : 'שגיאה.');
    } finally {
      setSubmittingExecution(false);
      setPendingExecution(null);
    }
  }, [pendingExecution, toast]);

  const sortedRows = useMemo(() => {
    const order = ['Hourly', 'Daily', 'Weekly', 'Long'];
    return [...rows].sort((a, b) => {
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      return order.indexOf(a.timeframe) - order.indexOf(b.timeframe);
    });
  }, [rows]);

  return (
    <section
      className="min-h-screen bg-[var(--background)] overflow-x-hidden pb-20 sm:pb-0 text-zinc-100"
      dir="rtl"
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pb-12 pt-6 sm:pt-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">לוח אותות אלפא</h1>
            <p className="mt-2 text-sm text-zinc-300">
              מקור אמת יחיד מ-PostgreSQL — מטריצת Tri-Core (Groq שעתי, Anthropic יומי, Gemini שבועי/ארוך).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {godTier && (
              <span className="rounded-full border border-emerald-500/50 bg-emerald-950/40 px-3 py-1.5 text-xs font-bold text-emerald-200">
                מטריצת אלפא פעילה — רמת מוסדי
              </span>
            )}
            <span className="rounded-full border border-cyan-500/40 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-cyan-200">
              מצב: מסד נתונים חי
            </span>
            <button
              type="button"
              onClick={() => void loadSignals()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/50 bg-slate-800 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              רענון
            </button>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="scan-symbol" className="text-xs font-semibold text-zinc-400">
              סמל לסריקה
            </label>
            <select
              id="scan-symbol"
              value={scanSymbol}
              onChange={(e) => setScanSymbol(e.target.value as (typeof TOP_SCAN)[number])}
              className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {TOP_SCAN.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void onDeepScan()}
            disabled={scanning || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-500/50 bg-violet-950/50 px-4 py-2 text-sm font-bold text-violet-100 shadow-[0_0_20px_rgba(139,92,246,0.25)] disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            סריקת עומק
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/95">
          <table className="w-full min-w-[960px] text-right text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-xs uppercase tracking-wide text-zinc-400">
                <th className="px-3 py-3 font-semibold">סמל</th>
                <th className="px-3 py-3 font-semibold">אופק</th>
                <th className="px-3 py-3 font-semibold">כיוון</th>
                <th className="px-3 py-3 font-semibold w-40">הסתברות הצלחה</th>
                <th className="px-3 py-3 font-semibold">כניסה</th>
                <th className="px-3 py-3 font-semibold">יעד</th>
                <th className="px-3 py-3 font-semibold">סטופ לוס</th>
                <th className="px-3 py-3 font-semibold">גיבוי לווייתנים</th>
                <th className="px-3 py-3 font-semibold min-w-[200px]">נימוק ניתוח</th>
                <th className="px-3 py-3 font-semibold">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-zinc-400">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-400" />
                    <p className="mt-2">טוען אותות…</p>
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-zinc-300">
                    אין רשומות פעילות. לחץ על &quot;סריקת עומק&quot; ליצירת ארבעה אופקי זמן חדשים.
                  </td>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const ek = execKey[row.id] ?? 'idle';
                  return (
                    <tr key={row.id} className="border-b border-slate-800/80 hover:bg-slate-800/40">
                      <td className="px-3 py-3 font-bold text-white tabular-nums">{row.symbol}</td>
                      <td className="px-3 py-3">
                        <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-200">
                          {timeframeLabel(row.timeframe)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={
                            row.direction === 'Long'
                              ? 'text-emerald-300 font-semibold'
                              : 'text-rose-300 font-semibold'
                          }
                        >
                          {directionLabel(row.direction)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <ProbabilityBar value={row.winProbability} />
                      </td>
                      <td className="px-3 py-3 tabular-nums text-zinc-100">{row.entryPrice.toFixed(4)}</td>
                      <td className="px-3 py-3 tabular-nums text-emerald-200/90">{row.targetPrice.toFixed(4)}</td>
                      <td className="px-3 py-3 tabular-nums text-rose-200/90">{row.stopLoss.toFixed(4)}</td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={
                            row.whaleConfirmation
                              ? 'inline-flex items-center justify-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300'
                              : 'inline-flex items-center justify-center rounded-full bg-zinc-700/50 px-2 py-0.5 text-xs text-zinc-400'
                          }
                        >
                          {row.whaleConfirmation ? 'כן' : 'לא'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs leading-relaxed text-zinc-400 max-w-md">{row.rationaleHebrew}</td>
                      <td className="px-3 py-3">
                        {ek === 'executed' ? (
                          <span className="text-xs font-semibold text-emerald-400">בוצע</span>
                        ) : ek === 'blocked' ? (
                          <span className="text-xs font-semibold text-rose-400">חסום</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openExecute(row)}
                            disabled={ek === 'processing'}
                            className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-slate-800 px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                          >
                            {ek === 'processing' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                            בצע
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pendingExecution && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeModal} aria-hidden />
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            className="relative z-[var(--z-modal)] w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold text-white">אישור ביצוע</h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-slate-700 p-1.5 text-zinc-300 hover:bg-slate-800"
                aria-label="סגור"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-zinc-300">
              לאשר {pendingExecution.side === 'BUY' ? 'קנייה' : 'מכירה'} עבור{' '}
              <span className="font-semibold">{pendingExecution.row.symbol}</span> — אופק{' '}
              {timeframeLabel(pendingExecution.row.timeframe)} — ביטחון {pendingExecution.row.winProbability}%.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={submittingExecution}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-zinc-200"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={() => void confirmExecute()}
                disabled={submittingExecution}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/50 bg-slate-800 px-4 py-2 text-sm font-bold text-white"
              >
                {submittingExecution ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                אשר ושגר
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
