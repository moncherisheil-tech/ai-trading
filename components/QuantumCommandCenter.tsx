'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion } from 'motion/react';
import {
  closeVirtualPortfolioTradeAction,
  executeTradingSignalAction,
  getExecutionDashboardSnapshotAction,
  getSignalCoreTelemetryAction,
  updateTradingExecutionStatusAction,
  type SignalCoreTelemetryPayload,
} from '@/app/actions';

/** Obsidian & Wealth — institutional deck tokens */
const C = {
  void: '#000000',
  gold: '#c9a227',
  goldBright: '#e8d089',
  crimson: '#b91c1c',
  crimsonGlow: '#ef4444',
  titanium: 'rgba(148, 163, 184, 0.35)',
};

type DashboardSnap = {
  mode: 'PAPER' | 'LIVE';
  masterSwitchEnabled: boolean;
  minConfidenceToExecute: number;
  activeTrades: Array<{
    id: number;
    symbol: string;
    entryPrice: number;
    currentPrice: number;
    amountUsd: number;
    unrealizedPnlUsd: number;
    unrealizedPnlPct: number;
    targetProfitPct?: number;
    stopLossPct?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    analysisReasoning: {
      expertBreakdown: Record<string, unknown> | null;
      overseerSummary: string | null;
    } | null;
  }>;
  recentExecutions: Array<{
    symbol: string;
    signal: 'BUY' | 'SELL';
    confidence: number;
    executed: boolean;
    reason: string | null;
    status: string;
    expertBreakdown: Record<string, unknown> | null;
    overseerSummary: string | null;
  }>;
};

const SOVEREIGN_EXPERTS = [
  { key: 'technician', label: 'Technical Analyst', tag: 'TECH' },
  { key: 'riskManager', label: 'Risk Manager', tag: 'RISK' },
  { key: 'marketPsychologist', label: 'Market Psychology', tag: 'PSYCH' },
  { key: 'macroOrderBook', label: 'Macro / Order Book', tag: 'MACRO' },
  { key: 'onChainSleuth', label: 'On-Chain Sleuth', tag: 'CHAIN' },
  { key: 'deepMemory', label: 'Deep Memory', tag: 'MEMORY' },
] as const;

const SPARK_CAP = 56;

function pushCap(arr: number[], v: number, cap: number): number[] {
  const next = [...arr, v];
  while (next.length > cap) next.shift();
  return next;
}

function expertFromBreakdown(
  bd: Record<string, unknown> | null | undefined,
  key: string
): { score: number | null; logic: string } {
  if (!bd) return { score: null, logic: '' };
  const x = bd[key];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { score: null, logic: '' };
  const o = x as Record<string, unknown>;
  const scoreRaw = o.score;
  const n = typeof scoreRaw === 'number' ? scoreRaw : Number(scoreRaw);
  const logic = typeof o.logic === 'string' ? o.logic.trim() : '';
  return { score: Number.isFinite(n) ? n : null, logic };
}

function statusDot(score: number | null): 'green' | 'yellow' | 'red' {
  if (score == null) return 'yellow';
  if (score >= 58) return 'green';
  if (score >= 42) return 'yellow';
  return 'red';
}

function oneLineRationale(tag: string, logic: string): string {
  const line = logic.replace(/\s+/g, ' ').slice(0, 92);
  if (!line) return `${tag}: Awaiting board telemetry…`;
  return `${tag}: ${line}${logic.length > 92 ? '…' : ''}`;
}

function formatNum(n: number | null | undefined, fmt: 'exp' | 'fixed4'): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (fmt === 'exp') return n.toExponential(2);
  return n.toFixed(4);
}

function MicroSparkline({
  series,
  accent,
  label,
  valueDisplay,
}: {
  series: number[];
  accent: string;
  label: string;
  valueDisplay: string;
}) {
  const gradId = useId().replace(/:/g, '');

  const { d, minV, maxV } = useMemo(() => {
    if (series.length < 2) {
      return { d: 'M0,24 L120,24', minV: 0, maxV: 1 };
    }
    const vals = series.map((x) => (Number.isFinite(x) ? x : 0));
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi === lo) {
      lo -= 1;
      hi += 1;
    }
    const w = 120;
    const h = 48;
    const pad = 4;
    const pts = vals.map((v, i) => {
      const t = i / (vals.length - 1);
      const x = pad + t * (w - pad * 2);
      const yn = (v - lo) / (hi - lo);
      const y = h - pad - yn * (h - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return { d: `M${pts.join(' L')}`, minV: lo, maxV: hi };
  }, [series]);

  return (
    <div
      className="relative overflow-hidden rounded-lg border px-3 py-2"
      style={{
        borderColor: C.titanium,
        background: 'linear-gradient(145deg, rgba(255,255,255,0.04), rgba(0,0,0,0.5))',
        boxShadow: `inset 0 0 24px rgba(0,0,0,0.45), 0 0 20px ${accent}12`,
      }}
    >
      <p className="font-inter-tight text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <p
        className="mt-0.5 font-mono text-xs tabular-nums"
        style={{ color: accent, textShadow: `0 0 12px ${accent}44` }}
      >
        {valueDisplay}
      </p>
      <svg
        className="mt-1 h-[52px] w-full"
        viewBox="0 0 120 48"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accent} stopOpacity="0.05" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <motion.path
          d={d}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0.15, opacity: 0.5 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ pathLength: { type: 'spring', stiffness: 280, damping: 28 }, opacity: { duration: 0.35 } }}
        />
      </svg>
      <span className="sr-only">
        {label} series min {minV} max {maxV}
      </span>
    </div>
  );
}

export default function QuantumCommandCenter() {
  const [snap, setSnap] = useState<DashboardSnap | null>(null);
  const [telemetry, setTelemetry] = useState<SignalCoreTelemetryPayload | null>(null);
  const [tickSymbol, setTickSymbol] = useState('BTCUSDT');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdRaf = useRef<number | null>(null);

  const [cvdHist, setCvdHist] = useState<number[]>([]);
  const [entHist, setEntHist] = useState<number[]>([]);
  const [kalHist, setKalHist] = useState<number[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [dashRaw, telem] = await Promise.all([
        getExecutionDashboardSnapshotAction() as Promise<Partial<DashboardSnap> | null>,
        getSignalCoreTelemetryAction({ symbol: tickSymbol }),
      ]);
      const dash: DashboardSnap | null =
        dashRaw && typeof dashRaw === 'object'
          ? {
              mode: dashRaw.mode === 'LIVE' ? 'LIVE' : 'PAPER',
              masterSwitchEnabled: Boolean(dashRaw.masterSwitchEnabled),
              minConfidenceToExecute: dashRaw.minConfidenceToExecute ?? 80,
              activeTrades: Array.isArray(dashRaw.activeTrades) ? dashRaw.activeTrades : [],
              recentExecutions: Array.isArray(dashRaw.recentExecutions) ? dashRaw.recentExecutions : [],
            }
          : null;
      setSnap(dash);
      if (telem.ok) {
        setTelemetry(telem);
        if (telem.metrics) {
          setCvdHist((h) => pushCap(h, telem.metrics!.cvd_slope, SPARK_CAP));
          const e = telem.metrics.entropy_returns;
          if (e != null && Number.isFinite(e)) setEntHist((h) => pushCap(h, e, SPARK_CAP));
          const k = telem.metrics.kalman_velocity;
          if (k != null && Number.isFinite(k)) setKalHist((h) => pushCap(h, k, SPARK_CAP));
        }
      } else {
        setErr(telem.error);
      }
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Deck sync failed');
    }
  }, [tickSymbol]);

  useEffect(() => {
    void refresh();
    const i = setInterval(() => void refresh(), 4000);
    return () => clearInterval(i);
  }, [refresh]);

  const consensusPulse = useMemo(() => {
    if (!snap) return false;
    const th = snap.minConfidenceToExecute ?? 80;
    const last = snap.recentExecutions?.[0];
    return Boolean(last && last.confidence >= th);
  }, [snap]);

  const expertBreakdown = useMemo(() => {
    if (!snap) return null;
    const trade = snap.activeTrades?.[0];
    const fromTrade = trade?.analysisReasoning?.expertBreakdown;
    if (fromTrade) return fromTrade;
    const last = snap.recentExecutions?.[0];
    return last?.expertBreakdown ?? null;
  }, [snap]);

  const robotChassis = useMemo(() => {
    if (!snap) return 'INITIALIZING…';
    if ((snap.activeTrades?.length ?? 0) > 0) return 'IN POSITION';
    if (!snap.masterSwitchEnabled) return 'MANUAL OVERSIGHT · AUTO HALTED';
    const r = (snap.recentExecutions?.[0]?.reason || '').toLowerCase();
    if (r.includes('cvd') || r.includes('microstructure')) return 'WAITING FOR CVD CONFIRMATION';
    return 'ARMED · SCANNING';
  }, [snap]);

  const primaryTrade = snap?.activeTrades?.[0];
  const strikeHint = useMemo(() => {
    if (!snap?.recentExecutions?.length) {
      return { symbol: tickSymbol, side: 'BUY' as const, confidence: snap?.minConfidenceToExecute ?? 78 };
    }
    const rows = snap.recentExecutions ?? [];
    const row =
      rows.find((e) => e.signal === 'BUY' || e.signal === 'SELL') ?? rows[0];
    return {
      symbol: row.symbol || tickSymbol,
      side: row.signal,
      confidence: Math.round(row.confidence),
    };
  }, [snap, tickSymbol]);

  const setAutonomous = async (enabled: boolean) => {
    setBusy('toggle');
    try {
      const out = await updateTradingExecutionStatusAction({ masterSwitchEnabled: enabled });
      if (!out.success) setErr(out.error);
      else await refresh();
    } finally {
      setBusy(null);
    }
  };

  const liquidateAll = async () => {
    const open = snap?.activeTrades ?? [];
    if (!open.length) return;
    setBusy('kill');
    try {
      await Promise.all(open.map((t) => closeVirtualPortfolioTradeAction({ symbol: t.symbol })));
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kill sequence failed');
    } finally {
      setBusy(null);
    }
  };

  const clearHoldAnim = () => {
    if (holdRaf.current != null) cancelAnimationFrame(holdRaf.current);
    holdRaf.current = null;
    setHoldProgress(0);
  };

  const onHoldStart = () => {
    clearHoldAnim();
    const start = performance.now();
    const duration = 1400;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setHoldProgress(p);
      if (p >= 1) {
        clearHoldAnim();
        void (async () => {
          setBusy('strike');
          try {
            const out = await executeTradingSignalAction({
              symbol: strikeHint.symbol,
              side: strikeHint.side,
              confidence: strikeHint.confidence,
              priority: 'atomic',
            });
            if (!out.success) setErr(out.error);
            else await refresh();
          } finally {
            setBusy(null);
          }
        })();
        return;
      }
      holdRaf.current = requestAnimationFrame(step);
    };
    holdRaf.current = requestAnimationFrame(step);
  };

  useEffect(() => () => clearHoldAnim(), []);

  const metrics = telemetry?.metrics;
  const telemEnabled = telemetry?.enabled === true;

  return (
    <section
      className="relative min-h-screen overflow-x-hidden text-zinc-100"
      dir="ltr"
      style={{ backgroundColor: C.void }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.14]"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(201,162,39,0.25), transparent), radial-gradient(ellipse 60% 40% at 100% 50%, rgba(148,163,184,0.08), transparent)',
        }}
      />

      <div className="relative mx-auto w-full max-w-[1680px] space-y-5 px-4 py-6 sm:px-6 lg:px-10">
        {/* TIER 1 — CEO APEX */}
        <header
          className="flex flex-col gap-5 rounded-2xl border border-white/[0.08] p-5 sm:p-6"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.65) 100%)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-inter-tight text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500">
                Quantum Mon Chéri
              </p>
              <h1 className="font-inter-tight mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Omniscient Command Deck
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">
                Telemetry
                <input
                  type="text"
                  value={tickSymbol}
                  onChange={(e) => setTickSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16))}
                  className="w-28 rounded-md border border-white/10 bg-black/60 px-2 py-1 font-mono text-xs text-zinc-200 outline-none focus:border-amber-500/40"
                />
              </label>
              {snap ? (
                <span
                  className="rounded-md border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider"
                  style={{
                    borderColor: snap.mode === 'LIVE' ? C.crimson : C.titanium,
                    color: snap.mode === 'LIVE' ? C.crimsonGlow : '#94a3b8',
                  }}
                >
                  {snap.mode}
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MicroSparkline
              series={cvdHist.length >= 2 ? cvdHist : metrics ? [metrics.cvd_slope * 0.97, metrics.cvd_slope] : [0, 0]}
              accent="#5eead4"
              label="CVD slope"
              valueDisplay={metrics ? formatNum(metrics.cvd_slope, 'exp') : telemEnabled ? '…' : 'offline'}
            />
            <MicroSparkline
              series={entHist.length >= 2 ? entHist : metrics?.entropy_returns != null ? [metrics.entropy_returns, metrics.entropy_returns * 1.001] : [0, 0]}
              accent="#a78bfa"
              label="Entropy returns"
              valueDisplay={metrics?.entropy_returns != null ? formatNum(metrics.entropy_returns, 'fixed4') : '—'}
            />
            <MicroSparkline
              series={kalHist.length >= 2 ? kalHist : metrics?.kalman_velocity != null ? [metrics.kalman_velocity, metrics.kalman_velocity * 1.02] : [0, 0]}
              accent={C.goldBright}
              label="Kalman velocity"
              valueDisplay={metrics?.kalman_velocity != null ? formatNum(metrics.kalman_velocity, 'exp') : '—'}
            />
          </div>

          {!telemEnabled && telemetry?.message ? (
            <p className="text-center text-[11px] text-zinc-500">{telemetry.message}</p>
          ) : null}
          {metrics?.noise_flag ? (
            <p className="text-center font-inter-tight text-[11px] font-semibold uppercase tracking-widest text-amber-400/90">
              Noise flag · elevated micro uncertainty
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.07] pt-5">
            <div className="flex flex-col gap-2">
              <span className="font-inter-tight text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-500">
                Executive authority
              </span>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={snap?.masterSwitchEnabled ?? false}
                    aria-label={snap?.masterSwitchEnabled ? 'Autonomous engine on' : 'Executive override — auto halted'}
                    disabled={busy !== null}
                    onClick={() => void setAutonomous(!snap?.masterSwitchEnabled)}
                    className="relative h-12 w-[6.5rem] shrink-0 rounded-full border-2 transition-colors"
                    style={{
                      borderColor: snap?.masterSwitchEnabled ? `${C.gold}88` : `${C.crimson}aa`,
                      background: snap?.masterSwitchEnabled
                        ? `linear-gradient(135deg, rgba(201,162,39,0.2), rgba(0,0,0,0.9))`
                        : `linear-gradient(135deg, rgba(185,28,28,0.35), rgba(0,0,0,0.92))`,
                      boxShadow: snap?.masterSwitchEnabled
                        ? `0 0 28px ${C.gold}33, inset 0 1px 0 rgba(255,255,255,0.12)`
                        : `0 0 24px ${C.crimson}40, inset 0 1px 0 rgba(255,255,255,0.06)`,
                    }}
                  >
                    <motion.span
                      className="absolute top-1 h-10 w-10 rounded-full border border-white/25"
                      style={{
                        left: '0.25rem',
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.4), rgba(90,90,90,0.35))',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.65)',
                      }}
                      animate={{ x: snap?.masterSwitchEnabled ? 56 : 0 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  </button>
                  <span
                    className="font-inter-tight text-[9px] font-bold uppercase tracking-[0.2em]"
                    style={{ color: snap?.masterSwitchEnabled ? C.goldBright : C.crimsonGlow }}
                  >
                    {snap?.masterSwitchEnabled ? 'Autonomous' : 'Override'}
                  </span>
                </div>
                <p className="max-w-xs text-[11px] leading-relaxed text-zinc-500">
                  <span className="text-zinc-300">Executive override</span> halts the autonomous engine. You retain
                  manual strike and liquidation.
                </p>
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <button
                type="button"
                disabled={busy !== null || !(snap?.activeTrades?.length ?? 0)}
                onClick={() => void liquidateAll()}
                className="rounded-lg border px-4 py-2.5 font-inter-tight text-xs font-bold uppercase tracking-[0.2em] transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                style={{
                  borderColor: `${C.crimson}99`,
                  color: C.crimsonGlow,
                  background: 'linear-gradient(180deg, rgba(185,28,28,0.25), rgba(0,0,0,0.85))',
                  boxShadow: `0 0 20px ${C.crimson}22`,
                }}
              >
                Liquidate exposure
              </button>
              <span className="text-[10px] text-zinc-600">Closes all open virtual positions immediately.</span>
            </div>
          </div>
        </header>

        {err ? (
          <div
            className="rounded-xl border px-4 py-3 text-sm"
            style={{ borderColor: `${C.crimson}55`, color: '#fecaca', background: 'rgba(127,29,29,0.25)' }}
          >
            {err}
          </div>
        ) : null}

        {/* Consensus energy conduit */}
        <div className="relative">
          {consensusPulse ? (
            <motion.div
              className="pointer-events-none absolute -top-6 left-1/2 z-0 h-24 w-px -translate-x-1/2 rounded-full"
              style={{
                background: `linear-gradient(180deg, transparent, ${C.gold}, transparent)`,
                filter: 'blur(0.5px)',
              }}
              animate={{ opacity: [0.25, 0.85, 0.25], scaleY: [0.8, 1.15, 0.8] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              aria-hidden
            />
          ) : null}

          {/* TIER 2 — TRADING ROBOT */}
          <motion.article
            className="relative z-[1] mx-auto max-w-3xl rounded-2xl border border-white/[0.1] p-6 sm:p-8"
            style={{
              background: 'linear-gradient(165deg, rgba(255,255,255,0.05), rgba(0,0,0,0.75))',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: consensusPulse
                ? `0 0 48px ${C.gold}22, inset 0 0 0 1px rgba(201,162,39,0.15)`
                : 'inset 0 0 0 1px rgba(255,255,255,0.04)',
            }}
            animate={consensusPulse ? { borderColor: 'rgba(201,162,39,0.35)' } : { borderColor: 'rgba(255,255,255,0.1)' }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
              <div>
                <p className="font-inter-tight text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500">
                  Tier 2 · Quantum executioner
                </p>
                <h2 className="font-inter-tight mt-1 text-xl font-semibold text-white">Trading robot</h2>
              </div>
              <motion.span
                className="rounded-md px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-widest"
                style={{
                  color: consensusPulse ? C.goldBright : '#a1a1aa',
                  border: `1px solid ${consensusPulse ? `${C.gold}66` : 'rgba(255,255,255,0.12)'}`,
                  background: consensusPulse ? `linear-gradient(90deg, ${C.gold}22, transparent)` : 'rgba(0,0,0,0.4)',
                  textShadow: consensusPulse ? `0 0 12px ${C.gold}55` : undefined,
                }}
                animate={consensusPulse ? { scale: [1, 1.02, 1] } : {}}
                transition={{ duration: 1.8, repeat: Infinity }}
              >
                {robotChassis}
              </motion.span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.06] bg-black/40 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Entry</p>
                <p className="mt-1 font-mono text-lg text-zinc-100 tabular-nums">
                  {primaryTrade ? primaryTrade.entryPrice.toFixed(4) : '—'}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">{primaryTrade?.symbol ?? 'No open book'}</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/40 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Dynamic SL</p>
                <p className="mt-1 font-mono text-lg tabular-nums" style={{ color: C.crimsonGlow }}>
                  {primaryTrade?.stopLossPrice != null ? primaryTrade.stopLossPrice.toFixed(4) : '—'}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  {primaryTrade?.stopLossPct != null ? `${primaryTrade.stopLossPct}% vs entry` : ''}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-black/40 p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Take profit</p>
                <p className="mt-1 font-mono text-lg tabular-nums" style={{ color: C.goldBright }}>
                  {primaryTrade?.takeProfitPrice != null ? primaryTrade.takeProfitPrice.toFixed(4) : '—'}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  {primaryTrade?.targetProfitPct != null ? `+${primaryTrade.targetProfitPct}% vs entry` : ''}
                </p>
              </div>
            </div>

            {!snap?.masterSwitchEnabled ? (
              <div className="mt-6">
                <p className="mb-2 text-center font-inter-tight text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500">
                  Authorize strike
                </p>
                <button
                  type="button"
                  disabled={busy !== null}
                  onPointerDown={onHoldStart}
                  onPointerUp={clearHoldAnim}
                  onPointerLeave={clearHoldAnim}
                  className="relative w-full overflow-hidden rounded-xl border-2 py-4 font-inter-tight text-sm font-bold uppercase tracking-[0.2em] transition enabled:active:scale-[0.99] disabled:opacity-40"
                  style={{
                    borderColor: `${C.gold}aa`,
                    color: C.goldBright,
                    background: 'linear-gradient(180deg, rgba(201,162,39,0.15), rgba(0,0,0,0.9))',
                    boxShadow: `0 0 32px ${C.gold}18`,
                  }}
                >
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500/35 to-transparent"
                    style={{ width: `${holdProgress * 100}%` }}
                    transition={{ type: 'tween', duration: 0.05 }}
                    aria-hidden
                  />
                  <span className="relative z-[1]">
                    Hold to deploy · {strikeHint.symbol} {strikeHint.side} @ {strikeHint.confidence}%
                  </span>
                </button>
              </div>
            ) : (
              <p className="mt-6 text-center text-[11px] text-zinc-500">
                Autonomous engine armed — disable override to authorize a manual strike.
              </p>
            )}
          </motion.article>
        </div>

        {/* TIER 3 — HEX CONCLAVE */}
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="font-inter-tight text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500">
              Tier 3 · Hex conclave (6 experts)
            </p>
            {consensusPulse ? (
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.gold }}>
                Consensus channel open
              </span>
            ) : null}
          </div>

          <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {SOVEREIGN_EXPERTS.map((ex, idx) => {
              const { score, logic } = expertFromBreakdown(expertBreakdown, ex.key);
              const dot = statusDot(score);
              const dotColor =
                dot === 'green' ? '#4ade80' : dot === 'yellow' ? '#facc15' : C.crimsonGlow;
              const line = oneLineRationale(ex.tag, logic);
              return (
                <motion.div
                  key={ex.key}
                  className="group relative rounded-xl border border-white/[0.08] p-3"
                  style={{
                    background: 'linear-gradient(160deg, rgba(255,255,255,0.04), rgba(0,0,0,0.72))',
                    backdropFilter: 'blur(16px)',
                  }}
                  whileHover={{ borderColor: 'rgba(255,255,255,0.16)' }}
                  animate={
                    consensusPulse
                      ? { boxShadow: [`0 0 0 0 ${C.gold}00`, `0 0 20px 2px ${C.gold}22`, `0 0 0 0 ${C.gold}00`] }
                      : {}
                  }
                  transition={{
                    duration: 2.4,
                    repeat: consensusPulse ? Infinity : 0,
                    delay: idx * 0.08,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="relative h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: dotColor,
                        boxShadow: `0 0 10px ${dotColor}`,
                      }}
                    />
                    <span className="font-mono text-[9px] font-semibold text-zinc-600">{ex.tag}</span>
                  </div>
                  <p className="font-inter-tight mt-2 text-xs font-semibold text-zinc-200">{ex.label}</p>
                  <p className="mt-1 line-clamp-2 font-mono text-[10px] leading-snug text-zinc-400">{line}</p>
                  {logic.length > 0 ? (
                    <div
                      className="pointer-events-none absolute inset-0 z-10 rounded-xl border border-white/10 bg-black/95 p-3 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
                      style={{ backdropFilter: 'blur(12px)' }}
                    >
                      <p className="font-inter-tight text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        Full logic
                      </p>
                      <p className="mt-2 max-h-40 overflow-auto font-mono text-[10px] leading-relaxed text-zinc-300">
                        {logic}
                      </p>
                    </div>
                  ) : null}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
