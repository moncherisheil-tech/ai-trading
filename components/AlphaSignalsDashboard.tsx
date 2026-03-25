'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, X, Zap } from 'lucide-react';
import type { AdvisorySignal, AssetForecast } from '@/lib/trading/forecast-engine';
import { useToastOptional } from '@/context/ToastContext';
import { useLocale } from '@/hooks/use-locale';

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
      const response = await fetch('/api/trading/signals', { cache: 'no-store' });
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? 'Failed to load alpha signals.');
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
      const response = await fetch('/api/trading/execute-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: pendingExecution.asset,
          side: pendingExecution.side,
          confidence: pendingExecution.confidence,
        }),
      });
      const payload = (await response.json()) as ExecuteSignalResponse;
      const failedReason = payload.error ?? payload.data?.reason ?? payload.message ?? (t.executionRequestFailed ?? 'Execution request failed.');
      if (!response.ok || !payload.success) {
        if (payload.data?.status === 'blocked') {
          setExecutionStateByAsset((prev) => ({
            ...prev,
            [targetAsset]: { status: 'blocked', reason: payload.data?.reason ?? 'Risk limit' },
          }));
        } else {
          setExecutionStateByAsset((prev) => ({ ...prev, [targetAsset]: { status: 'idle' } }));
        }
        toast?.error(failedReason);
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
  }, [pendingExecution, toast]);

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-12 pt-6 md:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 md:text-3xl">{t.alphaSignalsAdvisory ?? 'Alpha Signals Advisory'}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {t.alphaSignalsSubtitle ?? 'Human-in-the-loop recommendations with short-horizon and swing forecasts.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-zinc-300">
            {t.dataMode ?? 'Data Mode'}: {t.liveAnalysis ?? 'Live Analysis'}
          </span>
          <button
            type="button"
            onClick={() => void loadSignals()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-200 backdrop-blur-xl transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t.refreshRunLiveAnalysis ?? 'Refresh / Run Live Analysis'}
          </button>
        </div>
      </div>

      {topPick && (
        <div className="relative mb-6 overflow-hidden rounded-3xl border border-cyan-300/35 bg-gradient-to-r from-cyan-500/15 via-violet-500/10 to-emerald-500/15 p-5 backdrop-blur-xl shadow-[0_0_40px_rgba(34,211,238,0.25)]">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="absolute -bottom-10 left-12 h-36 w-36 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-100">
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
        <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 backdrop-blur-xl">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          (() => {
            const cardExecution = executionStateByAsset[item.asset] ?? { status: 'idle' as const };
            const isProcessing = cardExecution.status === 'processing';
            const isExecuted = cardExecution.status === 'executed';
            const isBlocked = cardExecution.status === 'blocked';
            return (
          <article
            key={item.asset}
            className="rounded-2xl border border-white/15 bg-white/[0.04] p-4 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <p className="text-xl font-semibold text-zinc-100">{item.asset}</p>
                <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">AI Advisory Signal</p>
              </div>
              <ProbabilityRing probability={item.shortTermOutlook.probability} signal={item.shortTermOutlook.signal} />
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.15em] text-zinc-400">{t.nextFewHours ?? 'Next Few Hours'}</p>
                  <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${signalClass(item.shortTermOutlook.signal)}`}>
                    {getSignalLabel(item.shortTermOutlook.signal, locale)}
                  </span>
                </div>
                <p className="mb-1 text-xs text-zinc-500">{item.shortTermOutlook.timeframe}</p>
                <p className="text-sm text-zinc-200">{item.shortTermOutlook.rationale}</p>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.15em] text-zinc-400">{t.upcomingDays ?? 'Upcoming Days'}</p>
                  <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${signalClass(item.swingOutlook.signal)}`}>
                    {getSignalLabel(item.swingOutlook.signal, locale)}
                  </span>
                </div>
                <p className="mb-1 text-xs text-zinc-500">{item.swingOutlook.timeframe}</p>
                <p className="text-sm text-zinc-200">{item.swingOutlook.rationale}</p>
              </div>

              {isExecuted ? (
                <div className="mt-1 inline-flex w-full items-center justify-center rounded-xl border border-emerald-400/45 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-200 shadow-[0_0_22px_rgba(16,185,129,0.35)]">
                  ⚡ {t.executedTwapActive ?? 'Executed (TWAP Active)'}
                </div>
              ) : isBlocked ? (
                <div className="mt-1 inline-flex w-full items-center justify-center rounded-xl border border-rose-400/45 bg-rose-500/15 px-3 py-2 text-sm font-semibold text-rose-200 shadow-[0_0_22px_rgba(244,63,94,0.35)]">
                  🛡️ {t.blockedRiskLimit ?? 'Blocked: Risk Limit'}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    openExecutionModal(
                      item.asset,
                      item.shortTermOutlook.signal,
                      item.shortTermOutlook.probability
                    )
                  }
                  disabled={item.shortTermOutlook.signal === 'HOLD' || isProcessing}
                  className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/35 bg-violet-500/15 px-3 py-2 text-sm font-semibold text-violet-100 shadow-[0_0_22px_rgba(168,85,247,0.25)] backdrop-blur-xl transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:border-zinc-700/60 disabled:bg-zinc-900/40 disabled:text-zinc-500 disabled:shadow-none"
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  {isProcessing ? (t.processing ?? 'Processing...') : (t.approveAndExecute ?? 'Approve & Execute')}
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
          <p className="text-sm font-medium">{t.noActiveSignals ?? 'No active signals'}</p>
          <p className="mt-1 text-xs text-zinc-500">{t.awaitingSignalData ?? 'Awaiting live data from analysis and market feeds...'}</p>
        </div>
      )}

      {pendingExecution && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeExecutionModal} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm manual override"
            className="relative z-[91] w-full max-w-xl rounded-3xl border border-white/20 bg-white/[0.07] p-5 backdrop-blur-2xl shadow-[0_20px_70px_rgba(0,0,0,0.45)]"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-violet-200/90">{t.manualOverride ?? 'Manual Override'}</p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-100">{t.confirmDeploySignal ?? 'Confirm & Deploy Signal'}</h3>
              </div>
              <button
                type="button"
                onClick={closeExecutionModal}
                className="rounded-lg border border-white/15 bg-black/20 p-1.5 text-zinc-300 transition hover:bg-white/10"
                aria-label="Close confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm leading-6 text-zinc-200">
              {t.confirmManualOverrideText ?? 'Confirm Manual Override: Executing'} <span className="font-semibold">{pendingExecution.side}</span> {t.forAsset ?? 'for'}{' '}
              <span className="font-semibold">{pendingExecution.asset}</span>. {t.riskManagerExecutionText ?? 'The Quantum Risk Manager will automatically calculate safe position sizing and route via TWAP stealth execution.'}
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeExecutionModal}
                disabled={submittingExecution}
                className="rounded-xl border border-white/15 bg-black/25 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-60"
              >
                {t.cancel ?? 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => void confirmAndExecute()}
                disabled={submittingExecution}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/40 bg-cyan-400/15 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.25)] transition hover:bg-cyan-400/25 disabled:opacity-60"
              >
                {submittingExecution ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {t.confirmAndDeploy ?? 'Confirm & Deploy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
