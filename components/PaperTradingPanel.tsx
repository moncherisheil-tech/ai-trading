'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Lock, RefreshCw, Zap, Wallet, Crosshair, TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { getTradingExecutionStatusAction, updateTradingExecutionStatusAction } from '@/app/actions';

type ExecutionStatusResponse = {
  mode: 'PAPER' | 'LIVE';
  masterSwitchEnabled: boolean;
  minConfidenceToExecute: number;
  liveApiKeyConfigured: boolean;
  liveLocked: boolean;
  virtualBalanceUsd: number;
  winRatePct: number;
  activeTradesCount: number;
  activeTrades: Array<{
    id: number;
    symbol: string;
    entryPrice: number;
    currentPrice: number;
    amountUsd: number;
    unrealizedPnlUsd: number;
    unrealizedPnlPct: number;
    analysisReasoning: {
      reason: string | null;
      overseerSummary: string | null;
      overseerReasoningPath: string | null;
      expertBreakdown: Record<string, unknown> | null;
      createdAt: string | null;
    } | null;
  }>;
  recentExecutions: Array<{
    id: number;
    symbol: string;
    signal: 'BUY' | 'SELL';
    confidence: number;
    mode: 'PAPER' | 'LIVE';
    status: string;
    executed: boolean;
    reason: string | null;
    overseerSummary: string | null;
    overseerReasoningPath: string | null;
    expertBreakdown: Record<string, unknown> | null;
    executionPrice: number | null;
    amountUsd: number | null;
    virtualTradeId: number | null;
    createdAt: string;
  }>;
  alphaEvolution?: Array<{ closedAt: string; cumulativePnlUsd: number; rollingWinRatePct: number }>;
};

type AnalysisPayload = {
  assetSymbol: string;
  contextLabel: string;
  direction: 'BUY' | 'SELL' | null;
  confidence: number | null;
  reason: string | null;
  overseerSummary: string | null;
  overseerReasoningPath: string | null;
  expertBreakdown: Record<string, unknown> | null;
  createdAt: string | null;
};

const LTR_TERM_SPAN_CLASS = 'inline-block mx-1 font-mono text-cyan-400';
const GLASS_TILE = 'frosted-obsidian panel-sovereign-diamond sovereign-tilt bg-zinc-900/50 rounded-2xl shadow-lg';

const EN_TOKEN_RE = /(API Key|BTCUSDT|ETHUSDT|[A-Z0-9]{2,}USDT|RSI|MACD|EMA|Bullish|Bearish|Neutral|BUY|SELL|LIVE|PAPER)/g;
const EN_TOKEN_TEST_RE = /^(API Key|BTCUSDT|ETHUSDT|[A-Z0-9]{2,}USDT|RSI|MACD|EMA|Bullish|Bearish|Neutral|BUY|SELL|LIVE|PAPER)$/;

function renderEnTokensInHebrew(input: string): ReactNode {
  if (!input) return input;
  const parts = input.split(EN_TOKEN_RE);
  return parts.map((part, i) => {
    if (EN_TOKEN_TEST_RE.test(part)) {
      return (
        <span dir="ltr" className={LTR_TERM_SPAN_CLASS} key={`${part}-${i}`}>
          {part}
        </span>
      );
    }
    return <span key={`t-${i}`}>{part}</span>;
  });
}

function formatDirection(direction: AnalysisPayload['direction']): { label: string; className: string; dir: 'ltr' | 'rtl' } {
  if (direction === 'BUY') return { label: 'BUY', className: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 shadow-[0_0_12px_rgba(52,211,153,0.2)]', dir: 'ltr' };
  if (direction === 'SELL') return { label: 'SELL', className: 'bg-rose-500/20 text-rose-300 border border-rose-400/30 shadow-[0_0_12px_rgba(251,113,133,0.2)]', dir: 'ltr' };
  return { label: '—', className: 'bg-zinc-800/80 text-zinc-400 border border-white/5', dir: 'ltr' };
}

function TradeDirectionBadge({ direction }: { direction: AnalysisPayload['direction'] }) {
  const d = formatDirection(direction);
  return (
    <span
      dir={d.dir}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold font-mono whitespace-nowrap ${d.className}`}
    >
      {d.label}
    </span>
  );
}

async function loadStatus(): Promise<{ data: ExecutionStatusResponse | null; error: string | null }> {
  const out = await getTradingExecutionStatusAction();
  if (!out.success) return { data: null, error: out.error };
  return { data: out.data as ExecutionStatusResponse, error: null };
}

function ReasoningTrigger({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group relative overflow-hidden rounded-xl px-4 py-2.5 text-[11px] sm:text-xs font-bold font-mono uppercase tracking-[0.15em] text-cyan-100 transition-all duration-300 disabled:opacity-35 disabled:cursor-not-allowed disabled:shadow-none border border-cyan-400/40 bg-gradient-to-b from-cyan-500/25 to-cyan-950/40 shadow-[0_0_22px_rgba(34,211,238,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] hover:shadow-[0_0_32px_rgba(34,211,238,0.55),0_0_60px_rgba(34,211,238,0.15)] hover:border-cyan-300/60 hover:text-white hover:brightness-110 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
    >
      <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" aria-hidden />
      <span className="relative flex items-center gap-2">
        <Zap className="h-3.5 w-3.5 text-cyan-300 drop-shadow-[0_0_6px_rgba(34,211,238,0.9)]" aria-hidden />
        Reasoning
      </span>
    </button>
  );
}

export default function PaperTradingPanel() {
  const [status, setStatus] = useState<ExecutionStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await loadStatus();
    setStatus(data);
    setError(err);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const updateConfig = useCallback(
    async (payload: Partial<Pick<ExecutionStatusResponse, 'masterSwitchEnabled' | 'mode' | 'minConfidenceToExecute'>>) => {
      if (saving) return;
      setSaving(true);
      try {
        setError(null);
        const out = await updateTradingExecutionStatusAction(payload);
        if (out.success) {
          const data = out.data as { snapshot?: ExecutionStatusResponse | null };
          setStatus((data.snapshot as ExecutionStatusResponse) ?? null);
        } else {
          setError(out.error);
        }
      } finally {
        setSaving(false);
      }
    },
    [saving]
  );

  const activeTrades = useMemo(() => status?.activeTrades.slice(0, 6) ?? [], [status?.activeTrades]);

  return (
    <section
      className="relative z-[1] frosted-obsidian panel-sovereign-diamond sovereign-tilt z-depth-3 min-w-0 w-full max-w-full rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.55)] overflow-x-hidden overflow-y-visible backdrop-blur-[60px] border border-cyan-500/30"
      dir="rtl"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 sm:px-7 pt-6 sm:pt-7 pb-5 border-b border-cyan-500/20 bg-black/30 backdrop-blur-xl">
        <div className="absolute -top-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" aria-hidden />
        <div className="relative flex items-center gap-4 min-w-0">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/25 to-emerald-950/40 border border-emerald-400/50">
            <Crosshair className="h-6 w-6 text-emerald-400" aria-hidden />
          </div>
          <div>
            <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">Paper Trading</h3>
            <p className="text-xs font-bold text-emerald-300 uppercase tracking-[0.15em] mt-0.5">
              Autonomous Execution Engine
            </p>
          </div>
        </div>
        <button
          type="button"
          id="refresh-panel-btn"
          name="refresh-execution-status"
          onClick={() => void refresh()}
          className="group relative inline-flex items-center gap-2 text-xs font-bold px-5 py-3 rounded-xl transition-all duration-300 border border-cyan-400/50 text-cyan-100 bg-gradient-to-b from-cyan-500/20 to-cyan-950/30 shadow-[0_0_16px_rgba(34,211,238,0.2)] hover:shadow-[0_0_22px_rgba(34,211,238,0.3)] hover:border-cyan-300/70 active:scale-95 backdrop-blur-xl uppercase tracking-wider"
        >
          <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
          רענן
        </button>
      </div>

      <div className="p-6 sm:p-8 space-y-7 min-w-0 max-w-full overflow-x-hidden">
        {loading ? (
          <div className="text-sm text-zinc-500 animate-pulse py-12 text-center font-mono">טוען נתוני מנוע ביצוע…</div>
        ) : error ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-200" role="alert">
            {error}
          </div>
        ) : !status ? (
          <div className="text-sm text-zinc-500 py-12 text-center font-mono">אין נתונים זמינים כרגע.</div>
        ) : (
          <>
            {status.alphaEvolution && status.alphaEvolution.length >= 2 && (
              <div
                className={`${GLASS_TILE} p-4 sm:p-5 border border-cyan-500/25 shadow-[0_0_28px_rgba(34,211,238,0.15)]`}
                dir="ltr"
              >
                  <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="h-4 w-4 text-cyan-400" aria-hidden />
                  <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200 font-sans">
                    Alpha Evolution Curve
                  </h4>
                  <span className="text-[10px] text-zinc-600 font-mono">Cumulative PnL $ · Rolling win %</span>
                </div>
                <div className="h-[220px] w-full min-w-0 max-w-full overflow-x-hidden">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={status.alphaEvolution} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="closedAt"
                        tick={{ fill: '#71717a', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
                        tickFormatter={(v) => {
                          try {
                            return new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                          } catch {
                            return String(v);
                          }
                        }}
                      />
                      <YAxis
                        yAxisId="pnl"
                        tick={{ fill: '#22d3ee', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
                        tickFormatter={(v) => `$${v}`}
                        width={56}
                      />
                      <YAxis
                        yAxisId="wr"
                        orientation="right"
                        domain={[0, 100]}
                        tick={{ fill: '#a3e635', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
                        tickFormatter={(v) => `${v}%`}
                        width={40}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'rgba(9,9,11,0.92)',
                          border: '1px solid rgba(34,211,238,0.25)',
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                        labelFormatter={(v) => new Date(String(v)).toLocaleString()}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        yAxisId="pnl"
                        type="monotone"
                        dataKey="cumulativePnlUsd"
                        name="Cumulative PnL ($)"
                        stroke="#22d3ee"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        yAxisId="wr"
                        type="monotone"
                        dataKey="rollingWinRatePct"
                        name="Rolling win rate %"
                        stroke="#a3e635"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
              <button
                type="button"
                id="master-switch-toggle"
                name="toggle-master-switch"
                disabled={saving}
                onClick={() => void updateConfig({ masterSwitchEnabled: !status.masterSwitchEnabled })}
                className={`group relative overflow-hidden ${GLASS_TILE} px-5 py-5 text-start transition-all duration-300 border ${
                  status.masterSwitchEnabled
                    ? 'border-emerald-400/60 bg-gradient-to-br from-emerald-500/20 to-emerald-950/35 shadow-[0_0_28px_rgba(52,211,153,0.2)] ring-1 ring-emerald-500/40 hover:shadow-[0_0_36px_rgba(52,211,153,0.3)] hover:border-emerald-300/70 active:scale-95'
                    : 'border-rose-400/40 bg-gradient-to-br from-rose-500/15 to-rose-950/30 shadow-[0_0_20px_rgba(251,113,133,0.15)] ring-1 ring-rose-500/30 hover:shadow-[0_0_28px_rgba(251,113,133,0.25)] hover:border-rose-300/60 active:scale-95'
                } disabled:opacity-40 disabled:cursor-not-allowed backdrop-blur-xl`}
              >
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" aria-hidden />
                <div className="relative text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">Master Control</div>
                <div
                  className={`relative text-3xl font-black font-mono font-bold mt-2 transition-all duration-300 tabular-nums ${status.masterSwitchEnabled ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {status.masterSwitchEnabled ? 'ON' : 'OFF'}
                </div>
              </button>
              <div className={`${GLASS_TILE} relative px-5 py-5 border-cyan-500/40 group overflow-hidden`}>
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" aria-hidden />
                <div className="relative text-xs font-bold uppercase tracking-[0.2em] text-cyan-300 flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-cyan-400" />
                  Virtual Balance
                </div>
                <div className="relative text-2xl font-black font-mono live-data-number text-cyan-300 mt-2 tabular-nums">
                  ${status.virtualBalanceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className={`${GLASS_TILE} relative px-5 py-5 border-amber-500/40 group overflow-hidden`}>
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" aria-hidden />
                <div className="relative text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Active Positions</div>
                <div className="relative text-2xl font-black font-mono live-data-number text-amber-300 mt-2 tabular-nums">{status.activeTradesCount}</div>
              </div>
              <div className={`${GLASS_TILE} relative px-5 py-5 border-emerald-500/40 group overflow-hidden`}>
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" aria-hidden />
                <div className="relative text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Win Rate</div>
                <div className="relative text-2xl font-black font-mono live-data-number text-emerald-400 mt-2 tabular-nums">
                  {status.winRatePct.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                id="mode-paper-btn"
                name="select-paper-mode"
                disabled={saving}
                onClick={() => void updateConfig({ mode: 'PAPER' })}
                className={`group relative px-6 py-3 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all duration-300 border backdrop-blur-xl ${
                  status.mode === 'PAPER'
                    ? 'border-emerald-400/60 text-emerald-100 bg-gradient-to-b from-emerald-500/25 to-emerald-950/40 shadow-[0_0_22px_rgba(52,211,153,0.3)] hover:shadow-[0_0_30px_rgba(52,211,153,0.4)] hover:border-emerald-300/70 active:scale-95'
                    : 'border-white/15 text-zinc-400 bg-white/5 hover:bg-white/10 hover:border-white/25 hover:text-zinc-300 active:scale-95'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 rounded-xl" aria-hidden />
                <span className="relative">Paper</span>
              </button>
              <button
                type="button"
                id="mode-live-btn"
                name="select-live-mode"
                disabled
                className="group relative px-6 py-3 rounded-xl text-xs font-bold font-mono uppercase tracking-wider inline-flex items-center gap-2 transition-all duration-300 border border-rose-400/30 text-rose-400/60 bg-rose-500/8 cursor-not-allowed backdrop-blur-xl"
                title="ייפתח לאחר הזנת ואימות מפתח לבורסה"
              >
                <span dir="ltr" className="relative">
                  Live
                </span>
                <Lock className="w-4 h-4 relative" />
              </button>
              {status.liveLocked && (
                <span className="text-xs text-amber-400/90 font-medium">
                  <span dir="ltr" className={LTR_TERM_SPAN_CLASS}>
                    LIVE
                  </span>
                  נעול עד הזנת
                  <span dir="ltr" className={LTR_TERM_SPAN_CLASS}>
                    API Key
                  </span>
                </span>
              )}
            </div>

            {activeTrades.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-300 mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-gradient-to-l from-emerald-500/30 to-transparent max-w-[80px]" aria-hidden />
                  פוזיציות פעילות — Execution Ledger
                  <span className="h-px flex-1 bg-gradient-to-r from-emerald-500/30 to-transparent max-w-[80px]" aria-hidden />
                </h4>
                <div className="rounded-2xl border border-white/10 bg-black/40 max-w-full font-mono shadow-[0_0_24px_rgba(255,255,255,0.05)] overflow-x-auto max-h-[340px] overflow-y-auto financial-grid-compact" dir="ltr">
                  <table className="w-full min-w-[640px] border-collapse">
                    <thead className="sticky top-0 z-[var(--z-sticky)] bg-zinc-900/95 border-b border-white/10">
                      <tr className="text-[10px] uppercase tracking-widest text-zinc-500 font-sans">
                        <th className="text-start">Instrument</th>
                        <th className="text-end">Entry → Mark</th>
                        <th className="text-end">PnL $</th>
                        <th className="text-end pe-1">Audit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.08]">
                      {activeTrades.map((trade) => {
                        const up = trade.unrealizedPnlUsd >= 0;
                        return (
                          <tr
                            key={trade.id}
                            className="group items-center hover:bg-white/[0.05] transition-all duration-200"
                          >
                            <td className="text-start font-semibold text-zinc-200 tracking-tight">
                              {trade.symbol.replace('USDT', '')}
                              <span className="text-zinc-600 font-normal">/USDT</span>
                            </td>
                            <td className="text-end text-zinc-300 tabular-nums live-data-number whitespace-nowrap">
                              {trade.entryPrice.toFixed(4)} → {trade.currentPrice.toFixed(4)}
                            </td>
                            <td
                              className={`text-end font-black tabular-nums live-data-number ${up ? 'text-emerald-400' : 'text-rose-400'}`}
                            >
                              {up ? '+' : ''}
                              {trade.unrealizedPnlUsd.toFixed(2)}
                            </td>
                            <td className="text-end">
                              <ReasoningTrigger
                                disabled={!trade.analysisReasoning}
                                onClick={() =>
                                  setAnalysis({
                                    assetSymbol: trade.symbol.replace('USDT', ''),
                                    contextLabel: 'Active Position Analysis',
                                    direction: null,
                                    confidence: null,
                                    reason: trade.analysisReasoning?.reason ?? null,
                                    overseerSummary: trade.analysisReasoning?.overseerSummary ?? null,
                                    overseerReasoningPath: trade.analysisReasoning?.overseerReasoningPath ?? null,
                                    expertBreakdown: trade.analysisReasoning?.expertBreakdown ?? null,
                                    createdAt: trade.analysisReasoning?.createdAt ?? null,
                                  })
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {status.recentExecutions.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-300 mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-gradient-to-l from-cyan-500/30 to-transparent max-w-[80px]" aria-hidden />
                  ביצועים אחרונים
                  <span className="h-px flex-1 bg-gradient-to-r from-cyan-500/30 to-transparent max-w-[80px]" aria-hidden />
                </h4>
                <div className="space-y-2 max-h-56 overflow-y-auto pe-1">
                  {status.recentExecutions.map((ev) => (
                    <div
                      key={ev.id}
                      className={`${GLASS_TILE} relative px-5 py-4 flex flex-wrap items-center justify-between gap-3 group border-white/15 bg-black/40 shadow-[0_2px_8px_rgba(0,0,0,0.15)] hover:shadow-[0_4px_12px_rgba(34,211,238,0.1)] hover:border-cyan-500/40 transition-all duration-200 backdrop-blur-xl`}
                      dir="ltr"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-violet-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl" aria-hidden />
                      <div className="relative flex items-center gap-4 min-w-0 z-10">
                        <span className="font-mono font-bold text-lg text-white">{ev.symbol.replace('USDT', '')}</span>
                        <span
                          className={`text-xs font-black uppercase px-3 py-1 rounded-lg border font-mono ${
                            ev.signal === 'BUY'
                              ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/50'
                              : 'bg-rose-500/25 text-rose-300 border-rose-400/50'
                          }`}
                        >
                          {ev.signal}
                        </span>
                        <span className="text-cyan-300 font-mono font-bold live-data-number text-sm">{ev.confidence.toFixed(1)}%</span>
                      </div>
                      <div className="relative flex items-center gap-3 shrink-0 z-10">
                        <span
                          className={`text-xs font-bold uppercase tracking-wider font-mono inline-flex items-center gap-1.5 ${
                            ev.executed ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {ev.executed ? <span className="live-pulse-dot" aria-hidden /> : null}
                          {ev.status}
                        </span>
                        <ReasoningTrigger
                          onClick={() =>
                            setAnalysis({
                              assetSymbol: ev.symbol.replace('USDT', ''),
                              contextLabel: `${ev.signal} Execution Analysis`,
                              direction: ev.signal,
                              confidence: ev.confidence,
                              reason: ev.reason,
                              overseerSummary: ev.overseerSummary,
                              overseerReasoningPath: ev.overseerReasoningPath,
                              expertBreakdown: ev.expertBreakdown,
                              createdAt: ev.createdAt,
                            })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {analysis && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-label="Execution audit analysis"
            className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-800 bg-slate-950/95 backdrop-blur-sm p-6 sm:p-8 shadow-[0_18px_48px_rgba(0,0,0,0.45)] max-h-[90vh] overflow-y-auto"
          >
            <div className="mb-6 border-b border-white/5 pb-5">
              <div className="flex items-start gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-500/80">Execution Audit (XAI)</div>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
                    <h4 className="text-xl sm:text-2xl font-bold text-white truncate">
                      <span dir="ltr" className="inline-block mx-1 font-mono text-cyan-400">
                        {analysis.assetSymbol}
                      </span>
                    </h4>
                    <div className="flex items-center gap-3 flex-wrap">
                      <TradeDirectionBadge direction={analysis.direction} />
                      <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-200 whitespace-nowrap">
                        <span className="text-zinc-500 font-medium">AI Confidence</span>
                        <span dir="ltr" className="inline-block mx-1 font-mono live-data-number text-cyan-400">
                          {analysis.confidence != null ? `${analysis.confidence.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {analysis.contextLabel && <p className="mt-2 text-sm text-zinc-400">{analysis.contextLabel}</p>}
                  {analysis.createdAt && (
                    <p className="mt-2 text-xs text-zinc-600 font-mono" dir="ltr">
                      {new Date(analysis.createdAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  id="close-analysis-modal"
                  name="close-audit-modal"
                  onClick={() => setAnalysis(null)}
                  className="ms-auto rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500"
                >
                  סגור
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <section className="space-y-4" dir="rtl" aria-label="Hebrew analysis">
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Execution Reason</div>
                  <div className="text-zinc-200 leading-relaxed text-sm">
                    {analysis.reason ? renderEnTokensInHebrew(analysis.reason) : <span className="text-zinc-600">נתונים לא זמינים</span>}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Overseer Verdict</div>
                  <div className="text-zinc-200 leading-relaxed text-sm">
                    {analysis.overseerSummary ? renderEnTokensInHebrew(analysis.overseerSummary) : <span className="text-zinc-600">נתונים לא זמינים</span>}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Overseer Reasoning Path</div>
                  <div className="text-zinc-200 leading-relaxed text-sm">
                    {analysis.overseerReasoningPath ? renderEnTokensInHebrew(analysis.overseerReasoningPath) : <span className="text-zinc-600">נתונים לא זמינים</span>}
                  </div>
                </div>
              </section>
              <section className="space-y-4" dir="ltr" aria-label="Expert JSON breakdown">
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Expert JSON Breakdown</div>
                  {analysis.expertBreakdown ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                      {Object.keys(analysis.expertBreakdown).length > 0 ? (
                        Object.keys(analysis.expertBreakdown).map((key) => (
                          <div key={key} className="rounded-xl border border-white/5 bg-black/20 p-3 overflow-hidden">
                            <div className="text-[11px] font-semibold text-zinc-500 mb-2 truncate" dir="ltr">
                              {key}
                            </div>
                            <pre className="whitespace-pre-wrap break-words text-xs text-zinc-400 font-mono" dir="ltr">
                              {JSON.stringify(analysis.expertBreakdown?.[key], null, 2)}
                            </pre>
                          </div>
                        ))
                      ) : (
                        <div className="text-zinc-500 text-sm">נתונים לא זמינים</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-zinc-500 text-sm">נתונים לא זמינים</div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
