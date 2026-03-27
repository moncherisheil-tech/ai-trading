'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, X, Zap } from 'lucide-react';
import type { AdvisorySignal, AssetForecast } from '@/lib/trading/forecast-engine';
import { useToastOptional } from '@/context/ToastContext';
import { useLocale } from '@/hooks/use-locale';
import { executeTradingSignalAction, getTradingSignalsAction } from '@/app/actions';

type ApiResponse = {
  success: boolean;
  mode?: 'live';
  data?: AssetForecast[];
  error?: string;
};

type ExecuteSignalResponse = {
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

type CardExecutionState = {
  status: 'idle' | 'processing' | 'executed' | 'blocked';
  reason?: string;
};

function signalClass(signal: AdvisorySignal): string {
  if (signal === 'BUY') return 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30';
  if (signal === 'SELL') return 'text-rose-300 bg-rose-500/15 border-rose-400/30';
  return 'text-amber-200 bg-amber-500/15 border-amber-300/30';
}

function ringColor(signal: AdvisorySignal): string {
  if (signal === 'BUY') return '#34d399';
  if (signal === 'SELL') return '#fb7185';
  return '#facc15';
}

function getSignalLabel(signal: AdvisorySignal, locale: 'he' | 'en'): string {
  if (locale !== 'he') return signal;
  if (signal === 'BUY') return 'קנייה';
  if (signal === 'SELL') return 'מכירה';
  return 'המתן';
}

function ProbabilityRing({ probability, signal }: { probability: number; signal: AdvisorySignal }) {
  const p = Math.max(0, Math.min(100, probability));
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (p / 100) * circumference;

  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg className="h-24 w-24 -rotate-90" viewBox="0 0 80 80" role="img" aria-label={`Probability ${p}%`}>
        <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={ringColor(signal)}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-zinc-100">
        {p}%
      </div>
    </div>
  );
}

export default function AlphaSignalsDashboard() {
  const toast = useToastOptional();
  const criticalCyber = toast?.criticalCyber;
  const { t, locale } = useLocale();
  const [items, setItems] = useState<AssetForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingExecution, setPendingExecution] = useState<{
    asset: string;
    side: 'BUY' | 'SELL';
    confidence: number;
  } | null>(null);
  const [submittingExecution, setSubmittingExecution] = useState(false);
  const [executionStateByAsset, setExecutionStateByAsset] = useState<Record<string, CardExecutionState>>({});

  const loadSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await getTradingSignalsAction();
      if (!out.success) {
        throw new Error(out.error);
      }
      const payload = out.data as ApiResponse;
      if (!payload?.success || !payload.data) {
        throw new Error(payload?.error ?? 'Failed to load alpha signals.');
      }
      setItems(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alpha signals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSignals();
  }, [loadSignals]);

  const topPick = useMemo(() => {
    if (items.length === 0) return null;
    return [...items].sort((a, b) => b.shortTermOutlook.probability - a.shortTermOutlook.probability)[0];
  }, [items]);

  const openExecutionModal = useCallback((asset: string, side: AdvisorySignal, confidence: number) => {
    if (side === 'HOLD') {
      toast?.error(t.holdRequiresManualWait ?? 'HOLD signals require manual wait; execution is enabled only for BUY/SELL.');
      return;
    }
    const status = executionStateByAsset[asset]?.status ?? 'idle';
    if (status === 'processing') return;
    if (status === 'executed') {
      toast?.success(`${asset} ${t.alreadyExecutedTwapActive ?? 'already executed. TWAP is active.'}`);
      return;
    }
    if (status === 'blocked') {
      toast?.error(`${asset} ${t.blockedByRiskManager ?? 'is blocked by the Risk Manager.'}`);
      return;
    }
    setPendingExecution({ asset, side, confidence });
  }, [executionStateByAsset, toast]);

  const closeExecutionModal = useCallback(() => {
    if (!submittingExecution) setPendingExecution(null);
  }, [submittingExecution]);

  const confirmAndExecute = useCallback(async () => {
    if (!pendingExecution) return;
    const targetAsset = pendingExecution.asset;
    setSubmittingExecution(true);
    setExecutionStateByAsset((prev) => ({ ...prev, [targetAsset]: { status: 'processing' } }));
    try {
      const out = await executeTradingSignalAction({
        symbol: pendingExecution.asset,
        side: pendingExecution.side,
        confidence: pendingExecution.confidence,
      });

      if (!out.success) {
        setExecutionStateByAsset((prev) => ({ ...prev, [targetAsset]: { status: 'idle' } }));
        const msg = out.error || (t.executionRequestFailed ?? 'Execution request failed.');
        toast?.error(msg);
        criticalCyber?.(`[CRITICAL_CYBER_TOAST] Robot execution transport failure: ${msg}`);
        return;
      }

      const payload = out.data as ExecuteSignalResponse;

      const failedReason =
        payload.error ?? payload.data?.reason ?? payload.message ?? (t.executionRequestFailed ?? 'Execution request failed.');

      if (!payload.success) {
        if (payload.data?.status === 'blocked') {
          setExecutionStateByAsset((prev) => ({
            ...prev,
            [targetAsset]: { status: 'blocked', reason: payload.data?.reason ?? 'Risk limit' },
          }));
        } else {
          setExecutionStateByAsset((prev) => ({ ...prev, [targetAsset]: { status: 'idle' } }));
        }
        toast?.error(failedReason);
        if (payload.data?.status === 'failed') {
          criticalCyber?.(`[CRITICAL_CYBER_TOAST] Execution engine failed: ${failedReason}`);
        }
      } else {
        setExecutionStateByAsset((prev) => ({
          ...prev,
          [targetAsset]: { status: 'executed', reason: payload.data?.reason ?? 'TWAP Active' },
        }));
        toast?.success(t.signalDeployedSuccess ?? 'Signal Deployed. Trade sent to Quantum Command Center for TWAP execution.');
      }
    } catch (err) {
      setExecutionStateByAsset((prev) => ({ ...prev, [targetAsset]: { status: 'idle' } }));
      toast?.error(err instanceof Error ? err.message : (t.executionRequestFailed ?? 'Execution request failed.'));
    } finally {
      setSubmittingExecution(false);
      setPendingExecution(null);
    }
  }, [pendingExecution, toast, criticalCyber, t]);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-12 pt-6 md:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">{t.alphaSignalsAdvisory ?? 'Alpha Signals Advisory'}</h1>
          <p className="mt-2 text-sm text-zinc-300">
            {t.alphaSignalsSubtitle ?? 'Human-in-the-loop recommendations with short-horizon and swing forecasts.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-200 backdrop-blur-xl">
            <span className="relative inline-block h-2 w-2 rounded-full bg-emerald-400 me-2 animate-pulse" aria-hidden /> {t.dataMode ?? 'Data Mode'}: {t.liveAnalysis ?? 'Live Analysis'}
          </span>
          <button
            type="button"
            onClick={() => void loadSignals()}
            disabled={loading}
            className="group relative inline-flex items-center gap-2 rounded-xl border border-cyan-400/50 bg-gradient-to-b from-cyan-500/25 to-cyan-950/40 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.25)] backdrop-blur-xl transition hover:shadow-[0_0_24px_rgba(34,211,238,0.4)] hover:border-cyan-300/70 hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 rounded-xl" aria-hidden />
            {loading ? <Loader2 className="h-4 w-4 animate-spin relative" /> : <RefreshCw className="h-4 w-4 relative group-hover:rotate-180 transition-transform duration-500" />}
            <span className="relative">{t.refreshRunLiveAnalysis ?? 'Refresh'}</span>
          </button>
        </div>
      </div>

      {topPick && (
        <div className="relative mb-8 overflow-hidden rounded-3xl border border-cyan-400/50 bg-black/40 p-6 frosted-obsidian shadow-[0_0_40px_rgba(34,211,238,0.2)]">
          <div className="absolute -end-16 -top-16 h-56 w-56 rounded-full bg-cyan-500/25 blur-3xl animate-pulse opacity-60" />
          <div className="absolute -bottom-16 start-8 h-48 w-48 rounded-full bg-emerald-500/20 blur-3xl animate-pulse opacity-50" />
          <div className="absolute top-1/3 end-1/4 h-64 w-64 rounded-full bg-violet-500/15 blur-3xl animate-pulse opacity-40" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="ui-label inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-xs tracking-wide text-cyan-100" id="top-pick-label">
                <Sparkles className="h-3.5 w-3.5" />
                {t.topPickRightNow ?? 'Top Pick Right Now'}
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">{topPick.asset}</h2>
              <p className="mt-1 text-sm text-zinc-200">
                {getSignalLabel(topPick.shortTermOutlook.signal, locale)} {t.withShortTermConfidence ?? 'with short-term confidence'} {topPick.shortTermOutlook.probability}%.
              </p>
              <p className="mt-2 max-w-2xl text-sm text-zinc-300">{topPick.shortTermOutlook.rationale}</p>
            </div>
            <ProbabilityRing probability={topPick.shortTermOutlook.probability} signal={topPick.shortTermOutlook.signal} />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 frosted-obsidian">
          {error}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item, idx) => (
          (() => {
            const cardExecution = executionStateByAsset[item.asset] ?? { status: 'idle' as const };
            const isProcessing = cardExecution.status === 'processing';
            const isExecuted = cardExecution.status === 'executed';
            const isBlocked = cardExecution.status === 'blocked';
            return (
          <article
            key={item.asset}
            className="signal-row group relative rounded-2xl border border-white/20 bg-black/40 p-5 frosted-obsidian shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_12px_32px_rgba(34,211,238,0.12)] hover:border-cyan-400/60"
            style={{ '--row-index': idx } as React.CSSProperties}
          >
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500/10 via-transparent to-violet-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" aria-hidden />
            <div className="relative mb-5 flex items-center justify-between gap-3 z-10">
              <div>
                <p className="text-2xl font-black text-white tracking-tight">{item.asset}</p>
                <p className="ui-label text-xs tracking-wide text-zinc-300 font-semibold mt-1">AI Advisory Signal</p>
              </div>
              <ProbabilityRing probability={item.shortTermOutlook.probability} signal={item.shortTermOutlook.signal} />
            </div>

            <div className="relative space-y-3 z-10">
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 backdrop-blur-xl p-4 shadow-[0_0_12px_rgba(34,211,238,0.05)]">
                <div className="mb-3 flex items-center justify-between">
                  <p className="ui-label text-xs tracking-wide font-semibold text-cyan-200">{t.nextFewHours ?? 'Next Few Hours'}</p>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${signalClass(item.shortTermOutlook.signal)}`}>
                    {getSignalLabel(item.shortTermOutlook.signal, locale)}
                  </span>
                </div>
                <p className="mb-2 text-xs text-zinc-500 font-mono">{item.shortTermOutlook.timeframe}</p>
                <p className="text-sm leading-relaxed text-zinc-100">{item.shortTermOutlook.rationale}</p>
              </div>

              <div className="rounded-xl border border-violet-500/30 bg-violet-950/20 backdrop-blur-xl p-4 shadow-[0_0_12px_rgba(168,85,247,0.05)]">
                <div className="mb-3 flex items-center justify-between">
                  <p className="ui-label text-xs tracking-wide font-semibold text-violet-200">{t.upcomingDays ?? 'Upcoming Days'}</p>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${signalClass(item.swingOutlook.signal)}`}>
                    {getSignalLabel(item.swingOutlook.signal, locale)}
                  </span>
                </div>
                <p className="mb-2 text-xs text-zinc-500 font-mono">{item.swingOutlook.timeframe}</p>
                <p className="text-sm leading-relaxed text-zinc-100">{item.swingOutlook.rationale}</p>
              </div>

              {isExecuted ? (
                <div className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-emerald-400/60 bg-gradient-to-r from-emerald-500/20 to-emerald-950/30 px-4 py-3 text-sm font-bold text-emerald-100 shadow-[0_0_32px_rgba(52,211,153,0.4),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 me-2 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" aria-hidden /> {t.executedTwapActive ?? 'Executed (TWAP Active)'}
                </div>
              ) : isBlocked ? (
                <div className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-rose-400/60 bg-gradient-to-r from-rose-500/20 to-rose-950/30 px-4 py-3 text-sm font-bold text-rose-100 shadow-[0_0_32px_rgba(244,63,94,0.4),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl">
                  🛡️ {t.blockedRiskLimit ?? 'Blocked: Risk Limit'}
                </div>
              ) : (
                <button
                  type="button"
                  id={`execute-btn-${item.asset}`}
                  name={`execute-signal-${item.asset}`}
                  onClick={() =>
                    openExecutionModal(
                      item.asset,
                      item.shortTermOutlook.signal,
                      item.shortTermOutlook.probability
                    )
                  }
                  disabled={item.shortTermOutlook.signal === 'HOLD' || isProcessing}
                  className="group relative mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/60 bg-slate-800 hover:bg-slate-700 px-4 py-3 text-sm font-bold text-white shadow-[0_0_16px_rgba(34,211,238,0.2)] backdrop-blur-xl transition-all duration-300 hover:shadow-[0_0_24px_rgba(34,211,238,0.3)] hover:border-cyan-300/70 active:scale-95 disabled:cursor-not-allowed disabled:border-zinc-700/40 disabled:bg-zinc-900/30 disabled:text-zinc-500 disabled:shadow-none disabled:opacity-50"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 rounded-xl" aria-hidden />
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin relative" /> : <Zap className="h-4 w-4 relative" />}
                  <span className="relative">{isProcessing ? (t.processing ?? 'Processing...') : (t.approveAndExecute ?? 'Approve & Execute')}</span>
                </button>
              )}
            </div>
          </article>
            );
          })()
        ))}
      </div>
      {!loading && items.length === 0 && (
        <div className="mt-6 rounded-2xl border border-zinc-700/70 bg-zinc-900/40 px-5 py-8 text-center text-zinc-300">
          <p className="text-sm font-medium">
            {t.alphaSignalsEmptyStateHe ?? 'אין איתותים פעילים כרגע. המערכת ממתינה לסיום הניתוח המלא של מועצת הבינה המלאכותית.'}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {t.alphaSignalsEmptyStateEn ?? 'No active signals. Awaiting full analysis from the AI council.'}
          </p>
        </div>
      )}

      {pendingExecution && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeExecutionModal} aria-hidden />
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm manual override"
            className="relative z-[91] w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-950/95 p-6 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
          >
            <div className="mb-4 flex items-start gap-3">
              <div>
                <p className="ui-label text-xs tracking-wide text-violet-200/90">{t.manualOverride ?? 'Manual Override'}</p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-100">{t.confirmDeploySignal ?? 'Confirm & Deploy Signal'}</h3>
              </div>
              <button
                type="button"
                onClick={closeExecutionModal}
                className="ms-auto rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-zinc-300 transition hover:bg-slate-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
                aria-label="Close confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm leading-6 text-zinc-200">
              {t.confirmManualOverrideText ?? 'Confirm Manual Override: Executing'} <span className="font-semibold">{pendingExecution.side}</span> {t.forAsset ?? 'for'}{' '}
              <span className="font-semibold">{pendingExecution.asset}</span>. {t.riskManagerExecutionText ?? 'The Quantum Risk Manager will automatically calculate safe position sizing and route via TWAP stealth execution.'}
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeExecutionModal}
                disabled={submittingExecution}
                className="rounded-xl border border-white/20 bg-white/5 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-all duration-300 hover:bg-white/10 hover:border-white/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t.cancel ?? 'Cancel'}
              </button>
              <button
                type="button"
                id="confirm-deploy-btn"
                name="confirm-execution"
                onClick={() => void confirmAndExecute()}
                disabled={submittingExecution}
                className="group relative inline-flex items-center gap-2 rounded-xl border border-cyan-400/60 bg-slate-800 hover:bg-slate-700 px-5 py-2.5 text-sm font-bold text-white shadow-[0_0_16px_rgba(34,211,238,0.25)] transition-all duration-300 hover:shadow-[0_0_24px_rgba(34,211,238,0.35)] hover:border-cyan-300/80 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 rounded-xl" aria-hidden />
                {submittingExecution ? <Loader2 className="h-4 w-4 animate-spin relative" /> : <Zap className="h-4 w-4 relative" />}
                <span className="relative">{t.confirmAndDeploy ?? 'Confirm & Deploy'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
