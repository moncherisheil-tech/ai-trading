'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2, RefreshCw, Sparkles, X, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { AlphaSignalDTO } from '@/lib/alpha-signals-db';
import { useToastOptional } from '@/context/ToastContext';
import { AcademyTerm, RationaleWithAcademyTerms } from '@/components/AcademyTerm';
import {
  executeTradingSignalAction,
  generateAlphaMatrixAction,
  getLatestAlphaSignalsAction,
  recordRobotHandshakeFromDashboardAction,
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

const INSTITUTIONAL_USDT_PAIRS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'ADAUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'DOTUSDT',
  'MATICUSDT',
  'NEARUSDT',
  'LTCUSDT',
  'BCHUSDT',
  'FETUSDT',
  'INJUSDT',
  'RNDRUSDT',
  'ARBUSDT',
  'OPUSDT',
  'SHIBUSDT',
  'PEPEUSDT',
  'WIFUSDT',
  'SUIUSDT',
  'APTUSDT',
  'FILUSDT',
  'ATOMUSDT',
  'TIAUSDT',
  'LDOUSDT',
  'RUNEUSDT',
  'GALAUSDT',
] as const;

type ScanSymbol = (typeof INSTITUTIONAL_USDT_PAIRS)[number];

const SYSTEM_DATA_ERROR_HE = 'שגיאת מערכת: לא ניתן למשוך נתונים כעת';
const SYSTEM_EXEC_ERROR_HE = 'שגיאת מערכת: לא ניתן לבצע את הפעולה כעת';

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

function formatLastUpdate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  if (diff >= 0 && diff < 60_000) return 'ממש עכשיו';
  const t = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
  return `${t} | ${date}`;
}

function probBarGradient(p: number): string {
  if (p >= 80) return 'linear-gradient(90deg, #15803d, #22c55e)';
  if (p >= 60) return 'linear-gradient(90deg, #ca8a04, #f97316)';
  return 'linear-gradient(90deg, #b91c1c, #ef4444)';
}

function ProbabilityBar({ value }: { value: number }) {
  const p = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full min-w-[100px]">
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
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
  const [scanSymbol, setScanSymbol] = useState<ScanSymbol>('BTCUSDT');
  const [godTier, setGodTier] = useState(false);
  const [pendingExecution, setPendingExecution] = useState<{
    row: AlphaSignalDTO;
    side: 'BUY' | 'SELL';
  } | null>(null);
  const [submittingExecution, setSubmittingExecution] = useState(false);
  const [execKey, setExecKey] = useState<Record<string, 'idle' | 'processing' | 'executed' | 'blocked'>>({});
  const [drawerRow, setDrawerRow] = useState<AlphaSignalDTO | null>(null);
  const [handshake, setHandshake] = useState(false);

  const loadSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await getLatestAlphaSignalsAction();
      if (!out.success) {
        setError(out.error);
        return;
      }
      setRows(out.data);
      setGodTier(out.data.length > 0);
    } catch {
      setError(SYSTEM_DATA_ERROR_HE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSignals();
  }, [loadSignals]);

  const grouped = useMemo(() => {
    const order = ['Hourly', 'Daily', 'Weekly', 'Long'];
    const map = new Map<string, AlphaSignalDTO[]>();
    for (const r of rows) {
      const list = map.get(r.symbol) ?? [];
      list.push(r);
      map.set(r.symbol, list);
    }
    const symbols = [...map.keys()].sort((a, b) => a.localeCompare(b));
    return symbols.map((symbol) => ({
      symbol,
      items: [...(map.get(symbol) ?? [])].sort(
        (a, b) => order.indexOf(a.timeframe) - order.indexOf(b.timeframe)
      ),
    }));
  }, [rows]);

  const onDeepScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const sym = scanSymbol;
      const out = await generateAlphaMatrixAction(sym);
      if (!out.success) {
        toast?.error(out.error);
        return;
      }
      toast?.success('סריקת עומק הושלמה — הנתונים עודכנו במסד הנתונים.');
      await loadSignals();
    } catch {
      toast?.error(SYSTEM_DATA_ERROR_HE);
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
        toast?.error(SYSTEM_EXEC_ERROR_HE);
        return;
      }
      const payload = out.data as ExecutePayload;
      const inner = payload.data;
      if (!payload.success || inner?.status === 'blocked') {
        setExecKey((prev) => ({ ...prev, [k]: inner?.status === 'blocked' ? 'blocked' : 'idle' }));
        toast?.error(SYSTEM_EXEC_ERROR_HE);
        return;
      }
      setExecKey((prev) => ({ ...prev, [k]: 'executed' }));
      void recordRobotHandshakeFromDashboardAction();
      setHandshake(true);
      window.setTimeout(() => setHandshake(false), 3200);
      toast?.success('האות נשלח למרכז הפיקוד לביצוע TWAP.');
    } catch {
      setExecKey((prev) => ({ ...prev, [k]: 'idle' }));
      toast?.error(SYSTEM_EXEC_ERROR_HE);
    } finally {
      setSubmittingExecution(false);
      setPendingExecution(null);
    }
  }, [pendingExecution, toast]);

  return (
    <section
      className="min-h-screen bg-[var(--background)] overflow-x-hidden pb-20 sm:pb-0 text-zinc-100"
      dir="rtl"
    >
      <AnimatePresence>
        {handshake ? (
          <motion.div
            key="handshake"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
            aria-hidden
          >
            <motion.div
              className="absolute inset-0 bg-cyan-500/10 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            />
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: [0.85, 1.05, 1], opacity: 1 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              className="relative z-[1] flex flex-col items-center gap-3 rounded-3xl border border-cyan-400/40 bg-slate-950/85 px-10 py-8 shadow-[0_0_60px_rgba(34,211,238,0.25)]"
            >
              <motion.div
                animate={{ rotate: [0, 8, -8, 0] }}
                transition={{ repeat: 2, duration: 0.5 }}
                className="text-4xl"
              >
                🤝
              </motion.div>
              <p className="text-center text-sm font-bold tracking-wide text-cyan-100">לחיצת יד עם הרובוט הושלמה</p>
              <p className="text-center text-xs text-zinc-400">סנכרון פיקוד · מסלול ביצוע פעיל</p>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pb-12 pt-6 sm:pt-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">לוח אותות אלפא</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-300">
              מקור אמת יחיד ממסד הנתונים — מטריצת טרי־קור. מונחים כמו{' '}
              <AcademyTerm href="/academy#glossary-dxy" title="מדד דולר — מילון באקדמיה">
                מדד דולר
              </AcademyTerm>
              ,{' '}
              <AcademyTerm href="/academy#glossary-cvd" title="נפח דלתא מצטבר — מילון באקדמיה">
                נפח דלתא מצטבר
              </AcademyTerm>{' '}
              ו־
              <AcademyTerm href="/academy#glossary-spoofing" title="ספופינג — מילון באקדמיה">
                ספופינג
              </AcademyTerm>{' '}
              מקושרים לאקדמיה.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {godTier && (
              <span className="rounded-full border border-emerald-500/50 bg-emerald-950/40 px-3 py-1.5 text-xs font-bold text-emerald-200">
                מטריצת אלפא פעילה
              </span>
            )}
            <span className="rounded-full border border-cyan-500/40 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-cyan-200">
              מסד נתונים חי
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
              onChange={(e) => setScanSymbol(e.target.value as ScanSymbol)}
              className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {INSTITUTIONAL_USDT_PAIRS.map((s) => (
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

        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/95 py-20">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
            <p className="mt-2 text-zinc-400">טוען אותות…</p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/95 px-4 py-10 text-center text-zinc-300">
            אין רשומות פעילות. לחצו על «סריקת עומק» ליצירת ארבעה אופקי זמן.
          </div>
        ) : (
          <div className="space-y-8">
            {grouped.map(({ symbol, items }) => (
              <div
                key={symbol}
                className="overflow-hidden rounded-2xl border border-slate-600/80 bg-gradient-to-br from-slate-900/98 via-slate-950 to-black/90 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/90 bg-slate-800/50 px-4 py-3 backdrop-blur-md">
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-cyan-500/15 px-2 py-1 font-mono text-lg font-bold tracking-tight text-white">
                      {symbol}
                    </span>
                    <span className="text-xs text-zinc-500">{items.length} אופקים פעילים</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-right text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        <th className="px-3 py-2.5">אופק</th>
                        <th className="px-3 py-2.5">כיוון</th>
                        <th className="px-3 py-2.5 w-36">הסתברות</th>
                        <th className="px-3 py-2.5">כניסה</th>
                        <th className="px-3 py-2.5">יעד</th>
                        <th className="px-3 py-2.5">סטופ</th>
                        <th className="px-3 py-2.5">לווייתנים</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">עדכון אחרון</th>
                        <th className="px-3 py-2.5 min-w-[140px]">נימוק</th>
                        <th className="px-3 py-2.5">פעולה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((row) => {
                        const ek = execKey[row.id] ?? 'idle';
                        return (
                          <tr key={row.id} className="border-b border-slate-800/80 hover:bg-slate-800/30">
                            <td className="px-3 py-2.5">
                              <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-200">
                                {timeframeLabel(row.timeframe)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={
                                  row.direction === 'Long'
                                    ? 'font-semibold text-emerald-300'
                                    : 'font-semibold text-rose-300'
                                }
                              >
                                {directionLabel(row.direction)}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <ProbabilityBar value={row.winProbability} />
                            </td>
                            <td className="px-3 py-2.5 tabular-nums text-zinc-100">{row.entryPrice.toFixed(4)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-emerald-200/90">{row.targetPrice.toFixed(4)}</td>
                            <td className="px-3 py-2.5 tabular-nums text-rose-200/90">{row.stopLoss.toFixed(4)}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span
                                className={
                                  row.whaleConfirmation
                                    ? 'inline-flex rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300'
                                    : 'inline-flex rounded-full bg-zinc-700/50 px-2 py-0.5 text-xs text-zinc-400'
                                }
                              >
                                {row.whaleConfirmation ? 'כן' : 'לא'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-xs tabular-nums text-zinc-400">
                              {formatLastUpdate(row.updatedAt)}
                            </td>
                            <td className="px-3 py-2.5 max-w-[200px]">
                              <button
                                type="button"
                                onClick={() => setDrawerRow(row)}
                                className="w-full text-right text-xs leading-relaxed text-zinc-400 hover:text-cyan-200 transition-colors line-clamp-2"
                              >
                                <RationaleWithAcademyTerms text={row.rationaleHebrew} />
                              </button>
                            </td>
                            <td className="px-3 py-2.5">
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
                                  {ek === 'processing' ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Zap className="h-3 w-3" />
                                  )}
                                  בצע
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {drawerRow && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex justify-start" dir="rtl">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-md" onClick={() => setDrawerRow(null)} aria-hidden />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="relative z-[var(--z-modal)] flex h-full w-full max-w-md flex-col border-l border-white/10 bg-slate-950/75 shadow-2xl backdrop-blur-xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-bold text-white">נימוק מלא</h3>
              <button
                type="button"
                onClick={() => setDrawerRow(null)}
                className="rounded-lg border border-slate-700 p-1.5 text-zinc-300 hover:bg-slate-800"
                aria-label="סגור"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-zinc-200">
              <p className="mb-6">
                <RationaleWithAcademyTerms text={drawerRow.rationaleHebrew} />
              </p>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="mb-2 flex items-center gap-2 text-xs font-bold text-amber-200/90">
                  <BookOpen className="h-4 w-4" />
                  המשך למידה
                </p>
                <ul className="space-y-2 text-xs text-zinc-400">
                  <li>
                    <AcademyTerm href="/academy#glossary-dxy" title="מדד דולר">
                      מדד דולר — מילון
                    </AcademyTerm>
                  </li>
                  <li>
                    <AcademyTerm href="/academy#glossary-cvd" title="נפח דלתא מצטבר">
                      נפח דלתא מצטבר — מילון
                    </AcademyTerm>
                  </li>
                  <li>
                    <AcademyTerm href="/academy#glossary-spoofing" title="ספופינג">
                      ספופינג — מילון
                    </AcademyTerm>
                  </li>
                  <li>
                    <AcademyTerm href="/academy" title="מרכז הלמידה">
                      כניסה לאקדמיה
                    </AcademyTerm>
                  </li>
                </ul>
              </div>
            </div>
          </motion.aside>
        </div>
      )}

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
