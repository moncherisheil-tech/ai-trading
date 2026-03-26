'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Cpu, Shield, Radio, Target, CheckCircle2, XCircle, Lock } from 'lucide-react';
import { getAdminTerminalFeedAction, updateTradingExecutionStatusAction } from '@/app/actions';
import { useToast } from '@/context/ToastContext';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithBackoff<T>(
  loader: () => Promise<{ success: true; data: T } | { success: false; error: string }>,
  maxAttempts = 3
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  let lastErr = 'שגיאה לא ידועה';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const out = await loader();
    if (out.success) return out;
    lastErr = out.error;
    if (attempt < maxAttempts) {
      await sleep(2 ** (attempt - 1) * 400);
    }
  }
  return { success: false, error: lastErr };
}

const FROST_PANEL =
  'frosted-obsidian relative overflow-hidden rounded-2xl bg-zinc-950/35 font-mono tabular-nums';

type SovereignReadiness = {
  score: number;
  factors: Array<{
    id: string;
    label: string;
    weight: number;
    score: number;
    ok: boolean;
    detail?: string;
  }>;
};

type GoLiveSafety = {
  allGreen: boolean;
  checks: Array<{ id: string; label: string; ok: boolean; detail: string }>;
};

type TerminalPayload = {
  snapshot?: {
    virtualBalanceUsd?: number;
    winRatePct?: number;
    activeTradesCount?: number;
    mode?: string;
    liveLocked?: boolean;
    liveApiKeyConfigured?: boolean;
    goLiveSafetyAcknowledged?: boolean;
  };
  readiness?: SovereignReadiness;
  goLiveSafety?: GoLiveSafety;
  fetchedAt?: string;
};

export default function AdminTerminalPageClient() {
  const { cyber, error: toastError, success: toastSuccess } = useToast();
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [goBusy, setGoBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const result = await fetchWithBackoff(getAdminTerminalFeedAction, 3);
    if (!result.success) {
      const msg =
        'אנומליה בזרם הנתונים — חידוש החיבור נכשל לאחר ניסיונות חוזרים. יש לבדוק את Quantum Core DB / מנוע הביצועים.';
      setErr(result.error);
      cyber(msg);
      toastError(result.error);
      setPayload(null);
    } else {
      setPayload(result.data);
    }
    setLoading(false);
  }, [cyber, toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const data = payload && typeof payload === 'object' && payload !== null ? (payload as TerminalPayload) : null;
  const snap = data?.snapshot ?? null;
  const readiness = data?.readiness;
  const goLiveSafety = data?.goLiveSafety;

  const handleGoLiveToggle = async (wantLive: boolean) => {
    if (wantLive) {
      if (!goLiveSafety?.allGreen) {
        toastError(
          'מעבר למצב מסחר חי נחסם: החלקה, יחס קלי־חשיפה או סטופ־לוס חייבים להיות בסטטוס תקין (ירוק).'
        );
        return;
      }
      setGoBusy(true);
      const res = await updateTradingExecutionStatusAction({
        mode: 'LIVE',
        goLiveSafetyAcknowledged: true,
      });
      setGoBusy(false);
      if (!res.success) {
        toastError(res.error);
        await load();
        return;
      }
      toastSuccess(
        'נשלחה בקשה למצב מסחר חי — יש להגדיר מפתחות בורסה בצד השרת; עיינו בשדה נעילת מצב חי (liveLocked) בפיד.'
      );
    } else {
      setGoBusy(true);
      const res = await updateTradingExecutionStatusAction({ mode: 'PAPER' });
      setGoBusy(false);
      if (!res.success) {
        toastError(res.error);
        await load();
        return;
      }
      toastSuccess('מצב ביצוע הוגדר לנייר (סימולציה).');
    }
    await load();
  };

  const isLive = (snap?.mode ?? '').toUpperCase() === 'LIVE';
  const canArmLive = Boolean(goLiveSafety?.allGreen) && !goBusy && !loading;

  return (
    <div
      className="w-full min-w-0 max-w-full min-h-[calc(100dvh-5rem)] overflow-x-hidden p-4 sm:p-8 bg-gradient-to-b from-zinc-950 via-black to-zinc-950"
      dir="rtl"
    >
      <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
        <header className={`${FROST_PANEL} p-6 sm:p-8`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-500/80 mb-2 flex items-center gap-2">
                <Radio className="h-3.5 w-3.5 text-cyan-400 animate-pulse" aria-hidden />
                חדר פיקוד מנכ״ל
              </p>
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">מסוף מצב-אל</h1>
              <p className="text-sm text-zinc-500 mt-2 max-w-xl">
                תצלום ביצוע עם פיד מתאושש (המתנה כפולה בין ניסיונות חוזרים). ממשקי הפעלה נשארים מאובטחים בכותרות; כאן
                אגרגציה בצד השרת.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="shrink-0 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors"
            >
              {loading ? 'מסנכרן…' : 'סנכרן מחדש'}
            </button>
          </div>
        </header>

        {err && !loading && (
          <div
            className={`${FROST_PANEL} border-rose-500/25 bg-rose-950/20 p-4 text-sm text-rose-200`}
            role="alert"
          >
            {err}
          </div>
        )}

        {readiness && (
          <div className={`${FROST_PANEL} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                <Target className="h-4 w-4 text-emerald-400" aria-hidden />
                מדד מוכנות ריבונית
              </div>
              <div
                className={`text-4xl font-black tabular-nums ${
                  readiness.score >= 94 ? 'text-emerald-400' : readiness.score >= 70 ? 'text-amber-300' : 'text-rose-300'
                }`}
              >
                {loading ? '—' : `${readiness.score}/100`}
              </div>
            </div>
            <p className="text-xs text-zinc-500 mb-3">
              מבוסס על תקינות מסד הנתונים, בדיקת מודל הטמעה{' '}
              <span className="font-mono text-zinc-300" dir="ltr" lang="en">
                text-embedding-004
              </span>{' '}
              (768 ממדים), Pinecone, דגל אינטגרציה{' '}
              <code className="text-cyan-600/90" dir="ltr" lang="en">
                TYPECHECK_PASSED
              </code>{' '}
              ויציבות נתיבי ליבה.
            </p>
            <ul className="space-y-2">
              {readiness.factors.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-start gap-2 text-[11px] sm:text-xs text-zinc-400 border border-white/5 rounded-lg p-2.5 bg-black/30"
                >
                  {f.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" aria-hidden />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-500/90 shrink-0 mt-0.5" aria-hidden />
                  )}
                  <span className="text-zinc-200 font-semibold">{f.label}</span>
                  <span className="text-zinc-500">+{f.score}/{f.weight}</span>
                  {f.detail ? <span className="w-full text-zinc-500 pl-6">{f.detail}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={`${FROST_PANEL} p-5 sm:p-6`}>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            שער מעבר למצב מסחר חי
          </h2>
          <p className="text-xs text-zinc-500 mb-4">
            מפתחות הבורסה מוזרקים דרך סביבת הריצה — המתג מאשר מסחר חי רק לאחר מעבר בדיקות בטיחות מוסדיות. ממשק ה-API אוכף
            את אותם כללים.
          </p>
          {goLiveSafety && (
            <ul className="space-y-2 mb-5">
              {goLiveSafety.checks.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-start gap-2 text-[11px] sm:text-xs rounded-lg border border-white/5 p-2.5 bg-black/25"
                >
                  {c.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" aria-hidden />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-500 shrink-0" aria-hidden />
                  )}
                  <span className="text-zinc-200 font-medium">{c.label}</span>
                  <span className="w-full text-zinc-500 pl-6">{c.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={loading || goBusy || isLive}
              onClick={() => void handleGoLiveToggle(true)}
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              {goBusy && !isLive ? 'מכין…' : 'מעבר למצב חי'}
            </button>
            <button
              type="button"
              disabled={loading || goBusy || !isLive}
              onClick={() => void handleGoLiveToggle(false)}
              className="rounded-xl border border-zinc-600/50 bg-zinc-900/60 px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              נייר (סימולציה)
            </button>
            {!canArmLive && !isLive ? (
              <span className="text-[11px] text-amber-400/90">
                כל בדיקות הבטיחות חייבות להיות תקינות כדי לאשר מסחר חי.
              </span>
            ) : null}
            {snap?.liveLocked ? (
              <span className="text-[11px] text-cyan-400/90 flex items-center gap-1">
                <Lock className="h-3 w-3" aria-hidden />
                נעילת מצב חי: יש להגדיר מפתחות בורסה מאומתים לביצוע מסחר חי אמיתי.
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={`${FROST_PANEL} p-5`}>
            <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-2">
              <Cpu className="h-3.5 w-3.5" aria-hidden />
              יתרה וירטואלית
            </div>
            <div className="text-2xl font-mono font-bold text-cyan-300 tabular-nums">
              {loading ? '—' : snap?.virtualBalanceUsd != null ? `$${Number(snap.virtualBalanceUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
            </div>
          </div>
          <div className={`${FROST_PANEL} p-5`}>
            <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-2">
              <Activity className="h-3.5 w-3.5" aria-hidden />
              אחוז ניצחונות
            </div>
            <div className="text-2xl font-mono font-bold text-lime-300 tabular-nums">
              {loading ? '—' : snap?.winRatePct != null ? `${Number(snap.winRatePct).toFixed(1)}%` : '—'}
            </div>
          </div>
          <div className={`${FROST_PANEL} p-5`}>
            <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-2">ספר פעיל</div>
            <div className="text-2xl font-mono font-bold text-white tabular-nums">
              {loading ? '—' : snap?.activeTradesCount ?? '—'}
            </div>
          </div>
          <div className={`${FROST_PANEL} p-5`}>
            <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-2">
              <Shield className="h-3.5 w-3.5" aria-hidden />
              מצב
            </div>
            <div className="text-2xl font-mono font-bold text-zinc-200">{loading ? '—' : snap?.mode ?? '—'}</div>
          </div>
        </div>

        <div className={`${FROST_PANEL} p-5 sm:p-6`}>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">פיד גולמי (פורמט JSON)</h2>
          <pre
            className="text-[11px] sm:text-xs font-mono text-zinc-400 overflow-x-auto max-h-[420px] overflow-y-auto rounded-xl bg-black/40 p-4 border border-white/5 max-w-full min-w-0"
            dir="ltr"
            lang="en"
          >
            {loading ? 'ממתין לערוץ מאובטח…' : JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
