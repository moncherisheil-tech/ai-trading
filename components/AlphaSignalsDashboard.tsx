'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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

type ManualOverride = {
  positionSizeUsd: number;
  noStopLoss: boolean;
  stopLossPct: number;
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

// ─── Executive Summary Drawer ────────────────────────────────────────────────

function SignalDrawer({ row, onClose }: { row: AlphaSignalDTO; onClose: () => void }) {
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const isLong   = (row.direction ?? '') === 'Long';
  const entry    = row.entryPrice    ?? 0;
  const target   = row.targetPrice   ?? 0;
  const stop     = row.stopLoss      ?? 0;
  const prob     = row.winProbability ?? 0;

  // Direction-aware ROI %
  const targetRoi = entry > 0 ? ((isLong ? target - entry : entry - target) / entry) * 100 : 0;
  const stopRoi   = entry > 0 ? ((isLong ? stop - entry  : entry - stop)   / entry) * 100 : 0;
  const rrRatio   = Math.abs(stopRoi) > 0.001 ? Math.abs(targetRoi / stopRoi) : 0;

  // Risk level (traffic-light)
  const riskLabel = prob >= 80 ? 'נמוך' : prob >= 65 ? 'בינוני' : 'גבוה';
  const riskCls   = prob >= 80
    ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
    : prob >= 65
    ? 'text-amber-300  border-amber-500/40  bg-amber-500/10'
    : 'text-rose-300   border-rose-500/40   bg-rose-500/10';

  // Recommended action
  const action = (() => {
    if (isLong  && prob >= 80) return { label: 'STRONG BUY',  labelHe: 'קנייה חזקה',  cls: 'from-emerald-900/80 to-emerald-950  border-emerald-400/50 text-emerald-100  shadow-[0_0_30px_rgba(52,211,153,0.25)]' };
    if (isLong  && prob >= 65) return { label: 'BUY',         labelHe: 'קנייה',        cls: 'from-emerald-950   to-slate-950     border-emerald-600/40 text-emerald-200  shadow-[0_0_16px_rgba(52,211,153,0.10)]' };
    if (!isLong && prob >= 80) return { label: 'STRONG SELL', labelHe: 'מכירה חזקה',  cls: 'from-rose-900/80   to-rose-950      border-rose-400/50    text-rose-100    shadow-[0_0_30px_rgba(239,68,68,0.25)]'  };
    if (!isLong && prob >= 65) return { label: 'SELL',        labelHe: 'מכירה',        cls: 'from-rose-950      to-slate-950     border-rose-600/40    text-rose-200    shadow-[0_0_16px_rgba(239,68,68,0.10)]'  };
    return                            { label: 'WAIT',        labelHe: 'המתן / בחינה', cls: 'from-amber-950     to-slate-950     border-amber-500/40   text-amber-200   shadow-[0_0_16px_rgba(245,158,11,0.10)]' };
  })();

  const dirBadgeCls = isLong
    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.30)]'
    : 'border-rose-400/60    bg-rose-500/20    text-rose-300    shadow-[0_0_12px_rgba(239,68,68,0.30)]';

  const headerBg = isLong
    ? 'bg-gradient-to-l from-emerald-950/50 to-slate-950'
    : 'bg-gradient-to-l from-rose-950/50    to-slate-950';

  return (
    <div className="fixed inset-0 z-[10000] flex justify-start" dir="rtl">
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-[9999] bg-black/75 backdrop-blur-md"
        onClick={onClose}
        aria-hidden
      />

      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="relative z-[10000] flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-white/10 bg-slate-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        {/* ── Header ── */}
        <div className={`flex items-center justify-between px-5 py-4 border-b border-white/10 ${headerBg}`}>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-lg font-bold tracking-tight text-white">
              {row.symbol ?? '—'}
            </span>
            {/* Direction Badge */}
            <span className={`rounded-full border px-3 py-0.5 text-xs font-black uppercase tracking-widest ${dirBadgeCls}`}>
              {isLong ? '▲ LONG' : '▼ SHORT'}
            </span>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-200">
              {timeframeLabel(row.timeframe ?? '')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 rounded-lg border border-slate-700 p-1.5 text-zinc-300 transition-colors hover:bg-slate-800"
            aria-label="סגור"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">

          {/* Stats Row: Risk / Confidence / Whale */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">רמת סיכון</p>
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${riskCls}`}>
                {riskLabel}
              </span>
            </div>
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">ביטחון</p>
              <p className={`text-xl font-black leading-none tabular-nums ${prob >= 80 ? 'text-emerald-300' : prob >= 65 ? 'text-amber-300' : 'text-rose-300'}`}>
                {prob}%
              </p>
            </div>
            <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 px-3 py-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">לווייתנים</p>
              <p className={`text-sm font-bold ${row.whaleConfirmation ? 'text-emerald-300' : 'text-zinc-500'}`}>
                {row.whaleConfirmation ? '✓ מאושר' : '✗ ממתין'}
              </p>
            </div>
          </div>

          {/* Recommended Action Callout */}
          <div className={`rounded-2xl border bg-gradient-to-br px-5 py-4 ${action.cls}`}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest opacity-60">פעולה מומלצת</p>
            <p className="text-2xl font-black tracking-tight">{action.label}</p>
            <p className="mt-0.5 text-sm font-semibold opacity-80">{action.labelHe}</p>
          </div>

          {/* Price Intelligence + Direction-Aware ROI */}
          <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/70">
            <div className="border-b border-slate-700/50 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">רמות מחיר ותשואה</p>
            </div>
            <div className="divide-y divide-slate-800/60">
              {/* Entry */}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-zinc-400">כניסה</span>
                <span className="font-mono text-sm font-semibold text-white tabular-nums">
                  {entry > 0 ? entry.toFixed(4) : 'N/A'}
                </span>
              </div>
              {/* Target + ROI */}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-zinc-400">יעד</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-emerald-200 tabular-nums">
                    {target > 0 ? target.toFixed(4) : 'N/A'}
                  </span>
                  {entry > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${targetRoi >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {targetRoi >= 0 ? '+' : ''}{targetRoi.toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
              {/* Stop Loss + Risk % */}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-zinc-400">סטופ לוס</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-rose-200 tabular-nums">
                    {stop > 0 ? stop.toFixed(4) : 'N/A'}
                  </span>
                  {entry > 0 && (
                    <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-bold tabular-nums text-rose-300">
                      {stopRoi.toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
              {/* R:R Ratio */}
              {rrRatio > 0 && (
                <div className="flex items-center justify-between bg-slate-800/40 px-4 py-3">
                  <span className="text-xs font-semibold text-zinc-400">יחס סיכון / תגמול</span>
                  <span className={`font-mono text-sm font-black tabular-nums ${rrRatio >= 2 ? 'text-emerald-300' : rrRatio >= 1 ? 'text-amber-300' : 'text-rose-300'}`}>
                    1 : {rrRatio.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Consensus Narrative */}
          <div className="overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/70">
            <div className="flex items-center gap-2 border-b border-slate-700/50 px-4 py-2.5">
              <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-violet-400" />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">ניתוח קונצנזוס</p>
            </div>
            <div className="px-4 py-4 text-sm leading-relaxed text-zinc-200">
              {(row.rationaleHebrew ?? '').trim() ? (
                <RationaleWithAcademyTerms text={row.rationaleHebrew} />
              ) : (
                <p className="italic text-zinc-500">ניתוח ממתין לעיבוד...</p>
              )}
            </div>
          </div>

          {/* Academy Links */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-bold text-amber-200/90">
              <BookOpen className="h-4 w-4 flex-shrink-0" />
              המשך למידה
            </p>
            <ul className="space-y-2 text-xs text-zinc-400">
              <li><AcademyTerm href="/academy#glossary-dxy" title="מדד דולר">מדד דולר — מילון</AcademyTerm></li>
              <li><AcademyTerm href="/academy#glossary-cvd" title="נפח דלתא מצטבר">נפח דלתא מצטבר — מילון</AcademyTerm></li>
              <li><AcademyTerm href="/academy#glossary-spoofing" title="ספופינג">ספופינג — מילון</AcademyTerm></li>
              <li><AcademyTerm href="/academy#glossary-vwap" title="VWAP">VWAP — מילון</AcademyTerm></li>
              <li><AcademyTerm href="/academy#glossary-contrarian" title="Contrarian">Contrarian — מילון</AcademyTerm></li>
              <li><AcademyTerm href="/academy" title="מרכז הלמידה">כניסה לאקדמיה</AcademyTerm></li>
            </ul>
          </div>

        </div>
      </motion.aside>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

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
  const [manualOverride, setManualOverride] = useState<ManualOverride>({
    positionSizeUsd: 50,
    noStopLoss: false,
    stopLossPct: 3,
  });
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
      // Seed override defaults from AI signal parameters
      const entry = row.entryPrice ?? 0;
      const stop = row.stopLoss ?? 0;
      const aiStopLossPct =
        entry > 0 && stop > 0
          ? Math.abs(((side === 'BUY' ? stop - entry : entry - stop) / entry) * 100)
          : 3;
      setManualOverride({
        positionSizeUsd: 50,
        noStopLoss: stop <= 0,
        stopLossPct: Math.max(0.5, parseFloat(aiStopLossPct.toFixed(2))),
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
        manualOverride: {
          positionSizeUsd: Math.max(1, manualOverride.positionSizeUsd),
          noStopLoss: manualOverride.noStopLoss,
          stopLossPct: manualOverride.noStopLoss ? 0 : Math.max(0.1, manualOverride.stopLossPct),
        },
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
  }, [pendingExecution, manualOverride, toast]);

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
              ,{' '}
              <AcademyTerm href="/academy#glossary-vwap" title="מחיר ממוצע משוקלל נפח — מילון באקדמיה">
                VWAP
              </AcademyTerm>
              {' '}ו־
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

      {drawerRow && <SignalDrawer row={drawerRow} onClose={() => setDrawerRow(null)} />}

      {pendingExecution && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 z-[9999] bg-black/80 backdrop-blur-md"
            onClick={closeModal}
            aria-hidden
          />
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            className="relative z-[10000] w-full max-w-lg rounded-3xl border border-slate-600/80 bg-slate-900 shadow-[0_0_60px_rgba(6,182,212,0.12)] overflow-hidden"
          >
            {/* ── Header ── */}
            <div className={`flex items-start justify-between gap-2 px-6 pt-5 pb-4 border-b border-slate-800 ${
              pendingExecution.side === 'BUY'
                ? 'bg-gradient-to-r from-emerald-950/40 to-slate-900'
                : 'bg-gradient-to-r from-rose-950/40 to-slate-900'
            }`}>
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Zap className="h-4 w-4 text-cyan-400" />
                  שליטה טקטית — ביצוע ידני
                </h3>
                <p className="mt-1 text-xs text-zinc-400">
                  <span className={`font-bold ${pendingExecution.side === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {pendingExecution.side === 'BUY' ? '▲ קנייה' : '▼ מכירה'}
                  </span>
                  {' '}·{' '}
                  <span className="font-mono text-zinc-200">{pendingExecution.row.symbol}</span>
                  {' '}· אופק {timeframeLabel(pendingExecution.row.timeframe)}
                  {' '}· ביטחון MoE{' '}
                  <span className={`font-bold ${pendingExecution.row.winProbability >= 80 ? 'text-emerald-300' : pendingExecution.row.winProbability >= 65 ? 'text-amber-300' : 'text-rose-300'}`}>
                    {pendingExecution.row.winProbability}%
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="mt-0.5 flex-shrink-0 rounded-lg border border-slate-700 p-1.5 text-zinc-300 hover:bg-slate-800"
                aria-label="סגור"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Tactical Override Inputs ── */}
            <div className="overflow-y-auto max-h-[calc(100dvh-14rem)] px-6 py-5 space-y-4">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">פרמטרי ביצוע ידניים — CEO Override</p>

              {/* Position Size */}
              <div className="space-y-1.5">
                <label className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                  <span>גודל פוזיציה (USD)</span>
                  <span className="text-zinc-500 font-normal">המלצת AI: $50</span>
                </label>
                <div className="relative">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">$</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={manualOverride.positionSizeUsd}
                    onChange={(e) =>
                      setManualOverride((prev) => ({
                        ...prev,
                        positionSizeUsd: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                      }))
                    }
                    className="w-full rounded-xl border border-slate-600 bg-slate-800 py-2.5 pr-8 pl-3 text-sm font-mono text-white focus:border-cyan-500/60 focus:outline-none"
                  />
                </div>
                <div className="flex gap-1.5">
                  {[10, 25, 50].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setManualOverride((prev) => ({ ...prev, positionSizeUsd: v }))}
                      className={`rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
                        manualOverride.positionSizeUsd === v
                          ? 'border-cyan-500/60 bg-cyan-950/50 text-cyan-200'
                          : 'border-slate-700 text-zinc-400 hover:border-slate-500'
                      }`}
                    >
                      ${v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stop Loss */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300">סטופ לוס (%)</label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                    <span>ללא סטופ לוס</span>
                    <div
                      role="checkbox"
                      aria-checked={manualOverride.noStopLoss}
                      tabIndex={0}
                      onClick={() =>
                        setManualOverride((prev) => ({ ...prev, noStopLoss: !prev.noStopLoss }))
                      }
                      onKeyDown={(e) =>
                        e.key === ' ' &&
                        setManualOverride((prev) => ({ ...prev, noStopLoss: !prev.noStopLoss }))
                      }
                      className={`relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full border transition-colors focus:outline-none ${
                        manualOverride.noStopLoss
                          ? 'border-rose-500/60 bg-rose-950/60'
                          : 'border-slate-600 bg-slate-800'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${
                          manualOverride.noStopLoss
                            ? 'translate-x-[18px] bg-rose-400'
                            : 'translate-x-[2px] bg-slate-500'
                        }`}
                      />
                    </div>
                  </label>
                </div>
                {!manualOverride.noStopLoss && (
                  <div className="relative">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">%</span>
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={manualOverride.stopLossPct}
                      onChange={(e) =>
                        setManualOverride((prev) => ({
                          ...prev,
                          stopLossPct: Math.max(0.1, Math.min(20, Number(e.target.value) || 3)),
                        }))
                      }
                      className="w-full rounded-xl border border-slate-600 bg-slate-800 py-2.5 pr-8 pl-3 text-sm font-mono text-white focus:border-cyan-500/60 focus:outline-none"
                    />
                  </div>
                )}
                {manualOverride.noStopLoss && (
                  <p className="rounded-lg border border-rose-500/20 bg-rose-950/20 px-3 py-2 text-xs text-rose-300/80">
                    ⚠️ ביצוע ללא סטופ לוס — סיכון בלתי מוגבל. האחריות על המנכ&quot;ל בלבד.
                  </p>
                )}
              </div>

              {/* Summary */}
              <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-3 text-xs space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>הון מוקצה</span>
                  <span className="font-mono font-semibold text-white">${manualOverride.positionSizeUsd}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>סטופ לוס</span>
                  <span className={`font-mono font-semibold ${manualOverride.noStopLoss ? 'text-rose-300' : 'text-amber-300'}`}>
                    {manualOverride.noStopLoss ? 'ללא' : `${manualOverride.stopLossPct.toFixed(1)}%`}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>מצב ביצוע</span>
                  <span className="font-semibold text-cyan-300">CEO Override · TWAP</span>
                </div>
              </div>
            </div>

            {/* ── Actions ── */}
            <div className="flex justify-end gap-2 border-t border-slate-800 px-6 pb-5 pt-4">
              <button
                type="button"
                onClick={closeModal}
                disabled={submittingExecution}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-slate-800 disabled:opacity-50"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={() => void confirmExecute()}
                disabled={submittingExecution}
                className={`inline-flex items-center gap-2 rounded-xl border px-5 py-2 text-sm font-bold text-white shadow-lg transition-all disabled:opacity-50 ${
                  pendingExecution.side === 'BUY'
                    ? 'border-emerald-500/50 bg-emerald-950/60 shadow-emerald-500/20 hover:bg-emerald-900/60'
                    : 'border-rose-500/50 bg-rose-950/60 shadow-rose-500/20 hover:bg-rose-900/60'
                }`}
              >
                {submittingExecution ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {submittingExecution ? 'שולח פקודה...' : 'שגר פקודה'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
