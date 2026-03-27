'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, X, Zap } from 'lucide-react';
import type { AdvisorySignal, AssetForecast, AssetOutlook } from '@/lib/trading/forecast-engine';
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

/** Display-only threshold for glowing card borders (UI). */
const HIGH_CONFIDENCE_MIN = 82;

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

/** UI-only macro row: blends short + swing outlooks for the Position tier (no API change). */
function buildMacroOutlook(item: AssetForecast): AssetOutlook {
  const s = item.shortTermOutlook;
  const w = item.swingOutlook;
  const probability = Math.round(0.35 * s.probability + 0.65 * w.probability);
  let signal: AdvisorySignal = 'HOLD';
  if (s.signal === w.signal) signal = s.signal;
  else signal = w.probability >= s.probability ? w.signal : s.signal;
  const rationale = [w.rationale, s.rationale].filter(Boolean).join(' · ').slice(0, 160) || '—';
  return {
    signal,
    probability,
    timeframe: '1-3 Days',
    rationale,
  };
}

/** UI-only SL / TP ladder and R:R from confidence (no price feed — percentages). */
function deriveDisplayLevels(item: AssetForecast): {
  slPct: number;
  tp1Pct: number;
  tp2Pct: number;
  tp3Pct: number;
  rr: number;
} {
  const p = item.shortTermOutlook.probability / 100;
  const uncertainty = Math.max(0, 1 - p);
  const slPct = Math.max(0.25, Math.min(8, 0.35 + uncertainty * 5.2));
  const tp1Pct = slPct * 1.25;
  const tp2Pct = slPct * 2.1;
  const tp3Pct = slPct * 3.45;
  const rr = slPct > 0 ? tp2Pct / slPct : 0;
  return {
    slPct,
    tp1Pct,
    tp2Pct,
    tp3Pct,
    rr: Math.round(rr * 100) / 100,
  };
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
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-zinc-100">
        {p}%
      </div>
    </div>
  );
}

function MtfMatrix({
  item,
  locale,
  t,
}: {
  item: AssetForecast;
  locale: 'he' | 'en';
  t: Record<string, string | undefined>;
}) {
  const macro = buildMacroOutlook(item);
  const flash = item.flashOutlook ?? {
    ...item.shortTermOutlook,
    timeframe: '⚡ FLASH',
  };
  const rows: { emoji: string; title: string; subtitle: string; o: AssetOutlook; horizonLine?: string }[] = [
    {
      emoji: '⚡',
      title: locale === 'he' ? 'FLASH' : 'FLASH',
      subtitle: locale === 'he' ? 'M1/M5 Hawk-Eye' : 'M1/M5 Hawk-Eye',
      o: flash,
      horizonLine: locale === 'he' ? 'High-velocity consensus' : 'High-velocity consensus',
    },
    {
      emoji: '🧠',
      title: locale === 'he' ? 'סקאלפ' : 'Scalp',
      subtitle: locale === 'he' ? 'תוך-יומי' : 'Intraday',
      o: item.shortTermOutlook,
    },
    {
      emoji: '🌊',
      title: locale === 'he' ? 'סווינג' : 'Swing',
      subtitle: locale === 'he' ? 'רב-יומי' : 'Multi-day',
      o: item.swingOutlook,
    },
    {
      emoji: '🏔️',
      title: locale === 'he' ? 'פוזיציה' : 'Position',
      subtitle: locale === 'he' ? 'מאקרו' : 'Macro',
      o: macro,
      horizonLine: locale === 'he' ? 'אופק מאקרו · שבועות' : 'Macro horizon · weeks',
    },
  ];

  return (
    <div className="rounded-lg border border-slate-700/80 bg-slate-950/60 p-3">
      <p className="ui-label mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {t.mtfMatrix ?? 'Multi-timeframe matrix'}
      </p>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div
            key={row.title}
            className="rounded-md border border-slate-700/50 bg-slate-900/80 px-2 py-1.5"
          >
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
              <span className="text-lg leading-none" aria-hidden>
                {row.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold leading-tight text-slate-200">
                  {row.title}{' '}
                  <span className="font-normal text-slate-500">({row.subtitle})</span>
                </p>
                <p className="truncate text-[10px] text-slate-500 tabular-nums">{row.horizonLine ?? row.o.timeframe}</p>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${signalClass(row.o.signal)}`}>
                  {getSignalLabel(row.o.signal, locale)}
                </span>
                <span className="text-[11px] font-semibold tabular-nums text-slate-300">{row.o.probability}%</span>
              </div>
            </div>
            <p className="mt-1 line-clamp-2 ps-7 text-[10px] leading-snug text-slate-400">{row.o.rationale}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function YieldRiskGrid({
  item,
  locale,
  t,
}: {
  item: AssetForecast;
  locale: 'he' | 'en';
  t: Record<string, string | undefined>;
}) {
  const { slPct, tp1Pct, tp2Pct, tp3Pct, rr } = deriveDisplayLevels(item);
  const side = item.shortTermOutlook.signal;

  return (
    <div className="rounded-lg border border-slate-700/80 bg-slate-950/50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="ui-label text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {t.yieldRiskLadder ?? 'Yield & risk'}
        </p>
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold tabular-nums ${
            side === 'BUY'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : side === 'SELL'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                : 'border-amber-500/35 bg-amber-500/10 text-amber-100'
          }`}
        >
          R:R {rr.toFixed(2)}:1
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded border border-slate-700/60 bg-slate-900/90 px-1 py-1.5">
          <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">TP1</p>
          <p className="text-[10px] text-slate-500">{locale === 'he' ? 'בטוח' : 'Safe'}</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-200/95">+{tp1Pct.toFixed(2)}%</p>
        </div>
        <div className="rounded border border-cyan-900/40 bg-slate-900/90 px-1 py-1.5 ring-1 ring-cyan-500/15">
          <p className="text-[9px] font-medium uppercase tracking-wide text-cyan-500/80">TP2</p>
          <p className="text-[10px] text-slate-500">{locale === 'he' ? 'אגרסיבי' : 'Aggressive'}</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-cyan-100">+{tp2Pct.toFixed(2)}%</p>
        </div>
        <div className="rounded border border-slate-700/60 bg-slate-900/90 px-1 py-1.5">
          <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500">TP3</p>
          <p className="text-[10px] text-slate-500">{locale === 'he' ? 'תשואה מקס׳' : 'Max yield'}</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-violet-200/95">+{tp3Pct.toFixed(2)}%</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 rounded border border-rose-900/35 bg-rose-950/20 px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-300/90">
          {t.stopLossLevel ?? 'Stop loss (SL)'}
        </span>
        <span className="text-sm font-bold tabular-nums text-rose-100">−{slPct.toFixed(2)}%</span>
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
  }, [executionStateByAsset, toast, t]);

  const closeExecutionModal = useCallback(() => {
    if (!submittingExecution) setPendingExecution(null);
  }, [submittingExecution]);

  const confirmAndExecute = useCallback(async () => {
    if (!pendingExecution) return;
    const targetAsset = pendingExecution.asset;
    setSubmittingExecution(true);
    setExecutionStateByAsset((prev) => ({ ...prev, [targetAsset]: { status: 'processing' } }));
    try {
      const targetItem = items.find((x) => x.asset === targetAsset);
      const highVelocityPriority = Boolean(targetItem?.hawkEye?.highVelocityPriority);
      const gapStrengthPct = Number(targetItem?.hawkEye?.gapStrengthPct ?? 0);
      const idempotencyKey = `hawkeye-${targetAsset}-${pendingExecution.side}-${Math.round(
        pendingExecution.confidence
      )}-${Math.floor(Date.now() / 15000)}`;
      const out = await executeTradingSignalAction({
        symbol: pendingExecution.asset,
        side: pendingExecution.side,
        confidence: pendingExecution.confidence,
        priority: highVelocityPriority ? 'atomic' : 'standard',
        hawkEye: {
          highVelocityPriority,
          liquidityGapDetected: Boolean(targetItem?.hawkEye?.liquidityGapDetected),
          gapStrengthPct,
        },
        idempotencyKey,
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
  }, [pendingExecution, toast, criticalCyber, t, items]);

  const tFlat = t as Record<string, string | undefined>;

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
          <span className="rounded-full border border-cyan-500/40 bg-slate-800/90 px-4 py-2 text-xs font-semibold text-cyan-200 backdrop-blur-xl">
            <span className="relative inline-block h-2 w-2 rounded-full bg-emerald-400 me-2 animate-pulse" aria-hidden /> {t.dataMode ?? 'Data Mode'}: {t.liveAnalysis ?? 'Live Analysis'}
          </span>
          <button
            type="button"
            onClick={() => void loadSignals()}
            disabled={loading}
            className="group relative inline-flex items-center gap-2 rounded-xl border border-cyan-400/50 bg-slate-800 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.2)] backdrop-blur-xl transition hover:shadow-[0_0_24px_rgba(34,211,238,0.35)] hover:border-cyan-300/70 hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-white/10 to-transparent motion-safe:-translate-x-full motion-safe:group-hover:translate-x-0 transition-transform duration-700" aria-hidden />
            {loading ? <Loader2 className="relative h-4 w-4 animate-spin" /> : <RefreshCw className="relative h-4 w-4 motion-safe:group-hover:rotate-180 transition-transform duration-500" />}
            <span className="relative">{t.refreshRunLiveAnalysis ?? 'Refresh'}</span>
          </button>
        </div>
      </div>

      {topPick && (
        <div className="relative mb-8 overflow-hidden rounded-3xl border border-slate-700 bg-slate-900/95 p-6 shadow-[0_0_32px_rgba(34,211,238,0.12)]">
          <div className="absolute -end-16 -top-16 h-56 w-56 rounded-full bg-cyan-500/20 blur-3xl motion-safe:animate-pulse opacity-60" />
          <div className="absolute -bottom-16 start-8 h-48 w-48 rounded-full bg-emerald-500/15 blur-3xl motion-safe:animate-pulse opacity-50" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="ui-label inline-flex items-center gap-2 rounded-full border border-cyan-500/35 bg-slate-800/80 px-3 py-1 text-xs tracking-wide text-cyan-100" id="top-pick-label">
                <Sparkles className="h-3.5 w-3.5" />
                {t.topPickRightNow ?? 'Top Pick Right Now'}
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">{topPick.asset}</h2>
              <p className="mt-1 text-sm text-zinc-200">
                {getSignalLabel(topPick.shortTermOutlook.signal, locale)} {t.withShortTermConfidence ?? 'with short-term confidence'}{' '}
                <span className="tabular-nums">{topPick.shortTermOutlook.probability}</span>%.
              </p>
              <p className="mt-2 max-w-2xl text-sm text-zinc-400">{topPick.shortTermOutlook.rationale}</p>
            </div>
            <ProbabilityRing probability={topPick.shortTermOutlook.probability} signal={topPick.shortTermOutlook.signal} />
          </div>
          <div className="relative mt-4 grid gap-3 md:grid-cols-2">
            <MtfMatrix item={topPick} locale={locale} t={tFlat} />
            <YieldRiskGrid item={topPick} locale={locale} t={tFlat} />
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item, idx) => (
          (() => {
            const cardExecution = executionStateByAsset[item.asset] ?? { status: 'idle' as const };
            const isProcessing = cardExecution.status === 'processing';
            const isExecuted = cardExecution.status === 'executed';
            const isBlocked = cardExecution.status === 'blocked';
            const st = item.shortTermOutlook;
            const highConf = st.probability >= HIGH_CONFIDENCE_MIN && st.signal !== 'HOLD';
            const glowLong = highConf && st.signal === 'BUY';
            const glowShort = highConf && st.signal === 'SELL';
            const cardBorder = glowLong
              ? 'border-emerald-500/45 shadow-[0_0_28px_rgba(16,185,129,0.28)]'
              : glowShort
                ? 'border-rose-500/45 shadow-[0_0_28px_rgba(244,63,94,0.28)]'
                : 'border-slate-700 shadow-none';
            return (
          <article
            key={item.asset}
            className={`signal-row group relative rounded-2xl border ${cardBorder} bg-slate-900/95 p-4 transition-colors duration-200 hover:border-slate-600`}
            style={{ '--row-index': idx } as React.CSSProperties}
          >
            <div className="relative z-10 mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xl font-black tracking-tight text-white">{item.asset}</p>
                <p className="ui-label mt-0.5 text-[10px] font-semibold tracking-wide text-slate-500">AI Advisory</p>
              </div>
              <ProbabilityRing probability={st.probability} signal={st.signal} />
            </div>

            <div className="relative z-10 space-y-2.5">
              <MtfMatrix item={item} locale={locale} t={tFlat} />
              <YieldRiskGrid item={item} locale={locale} t={tFlat} />

              {isExecuted ? (
                <div className="inline-flex w-full items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-2.5 text-xs font-bold text-emerald-100">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 me-2 animate-pulse" aria-hidden /> {t.executedTwapActive ?? 'Executed (TWAP Active)'}
                </div>
              ) : isBlocked ? (
                <div className="inline-flex w-full items-center justify-center rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2.5 text-xs font-bold text-rose-100">
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
                      st.signal,
                      st.probability
                    )
                  }
                  disabled={st.signal === 'HOLD' || isProcessing}
                  className="group relative mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-slate-800 px-3 py-2.5 text-xs font-bold text-white shadow-[0_0_12px_rgba(34,211,238,0.15)] transition hover:bg-slate-700 hover:shadow-[0_0_18px_rgba(34,211,238,0.25)] active:scale-[0.99] disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900/50 disabled:text-slate-500 disabled:shadow-none"
                >
                  <span className="absolute inset-0 rounded-lg bg-gradient-to-r from-transparent via-white/5 to-transparent motion-safe:-translate-x-full motion-safe:group-hover:translate-x-0 transition-transform duration-700" aria-hidden />
                  {isProcessing ? <Loader2 className="relative h-4 w-4 animate-spin" /> : <Zap className="relative h-4 w-4" />}
                  <span className="relative">{isProcessing ? (t.processing ?? 'Processing...') : (t.approveAndExecute ?? 'Approve & Execute')}</span>
                </button>
              )}
              {item.hawkEye?.highVelocityPriority && (
                <div className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200 tabular-nums text-center">
                  ⚡ Hawk-Eye Priority Lane · Gap {item.hawkEye.gapStrengthPct.toFixed(2)}%
                </div>
              )}
            </div>
          </article>
            );
          })()
        ))}
      </div>
      {!loading && items.length === 0 && (
        <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/80 px-5 py-8 text-center text-slate-300">
          <p className="text-sm font-medium">
            {t.alphaSignalsEmptyStateHe ?? 'אין איתותים פעילים כרגע. המערכת ממתינה לסיום הניתוח המלא של מועצת הבינה המלאכותית.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {t.alphaSignalsEmptyStateEn ?? 'No active signals. Awaiting full analysis from the AI council.'}
          </p>
        </div>
      )}

      {pendingExecution && (
        <div className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeExecutionModal} aria-hidden />
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm manual override"
            className="relative z-[var(--z-modal)] w-full max-w-xl rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
          >
            <div className="mb-4 flex items-start gap-3">
              <div>
                <p className="ui-label text-xs tracking-wide text-violet-200/90">{t.manualOverride ?? 'Manual Override'}</p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-100">{t.confirmDeploySignal ?? 'Confirm & Deploy Signal'}</h3>
              </div>
              <button
                type="button"
                onClick={closeExecutionModal}
                className="ms-auto rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-zinc-300 transition hover:bg-slate-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
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
                className="rounded-xl border border-slate-600 bg-slate-800/80 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-slate-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.cancel ?? 'Cancel'}
              </button>
              <button
                type="button"
                id="confirm-deploy-btn"
                name="confirm-execution"
                onClick={() => void confirmAndExecute()}
                disabled={submittingExecution}
                className="group relative inline-flex items-center gap-2 rounded-xl border border-cyan-500/50 bg-slate-800 px-5 py-2.5 text-sm font-bold text-white shadow-[0_0_16px_rgba(34,211,238,0.2)] transition hover:bg-slate-700 hover:shadow-[0_0_24px_rgba(34,211,238,0.3)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-white/5 to-transparent motion-safe:-translate-x-full motion-safe:group-hover:translate-x-0 transition-transform duration-700" aria-hidden />
                {submittingExecution ? <Loader2 className="relative h-4 w-4 animate-spin" /> : <Zap className="relative h-4 w-4" />}
                <span className="relative">{t.confirmAndDeploy ?? 'Confirm & Deploy'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
