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
      className="group relative overflow-hidden rounded-xl px-4 py-2.5 text-[11px] sm:text-xs font-bold font-mono uppercase tracking-[0.15em] text-cyan-100 transition-all duration-300 disabled:opacity-35 disabled:cursor-not-allowed disabled:shadow-none border border-cyan-400/40 bg-gradient-to-b from-cyan-500/25 to-cyan-950/40 shadow-[0_0_22px_rgba(34,211,238,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] hover:shadow-[0_0_32px_rgba(34,211,238,0.55),0_0_60px_rgba(34,211,238,0.15)] hover:border-cyan-300/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
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
      className="frosted-obsidian panel-sovereign-diamond sovereign-tilt z-depth-3 min-w-0 w-full max-w-full rounded-3xl shadow-2xl overflow-x-hidden overflow-y-visible"
      dir="rtl"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-white/5 bg-black/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-400/20 shadow-[0_0_20px_rgba(52,211,153,0.2)]">
            <Crosshair className="h-5 w-5 text-emerald-400" aria-hidden />
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">Paper Trading</h3>
            <p className="text-[11px] sm:text-xs font-medium text-zinc-500 uppercase tracking-[0.2em] mt-0.5">
              Autonomous Execution Engine
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="btn-neon-ghost inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          רענן
        </button>
      </div>

      <div className="p-5 sm:p-6 space-y-6 min-w-0 max-w-full overflow-x-hidden">
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
                className={`${GLASS_TILE} p-4 sm:p-5 border border-cyan-500/15`}
                dir="ltr"
              >
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="h-4 w-4 text-cyan-400" aria-hidden />
                  <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-400 font-sans">
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
                        tick={{ fill: '#71717a', fontSize: 10 }}
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
                        tick={{ fill: '#22d3ee', fontSize: 10 }}
                        tickFormatter={(v) => `$${v}`}
                        width={56}
                      />
                      <YAxis
                        yAxisId="wr"
                        orientation="right"
                        domain={[0, 100]}
                        tick={{ fill: '#a3e635', fontSize: 10 }}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <button
                type="button"
                disabled={saving}
                onClick={() => void updateConfig({ masterSwitchEnabled: !status.masterSwitchEnabled })}
                className={`${GLASS_TILE} px-4 py-4 text-start transition-all ${
                  status.masterSwitchEnabled
                    ? 'border-emerald-400/25 shadow-[0_0_24px_rgba(52,211,153,0.12)] ring-1 ring-emerald-500/20'
                    : 'border-rose-400/20 shadow-[0_0_20px_rgba(251,113,133,0.08)] ring-1 ring-rose-500/15'
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Master</div>
                <div
                  className={`text-2xl font-black font-mono mt-1 ${status.masterSwitchEnabled ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'text-rose-400 drop-shadow-[0_0_8px_rgba(251,113,133,0.4)]'}`}
                >
                  {status.masterSwitchEnabled ? 'ON' : 'OFF'}
                </div>
              </button>
              <div className={`${GLASS_TILE} px-4 py-4`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                  <Wallet className="h-3 w-3 text-cyan-400/80" />
                  Virtual Balance
                </div>
                <div className="text-xl font-bold font-mono live-data-number text-cyan-300 mt-1 tabular-nums shadow-[0_0_20px_rgba(34,211,238,0.15)]">
                  ${status.virtualBalanceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className={`${GLASS_TILE} px-4 py-4`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Active</div>
                <div className="text-xl font-bold font-mono live-data-number text-amber-200 mt-1 tabular-nums">{status.activeTradesCount}</div>
              </div>
              <div className={`${GLASS_TILE} px-4 py-4`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Win Rate</div>
                <div className="text-xl font-bold font-mono live-data-number text-emerald-400/90 mt-1 tabular-nums">
                  {status.winRatePct.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void updateConfig({ mode: 'PAPER' })}
                className={`btn-neon-ghost px-5 py-2.5 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all ${
                  status.mode === 'PAPER'
                    ? 'border border-cyan-400/45 text-cyan-200 bg-cyan-500/15 shadow-[0_0_20px_rgba(34,211,238,0.25)]'
                    : 'text-zinc-500'
                }`}
              >
                Paper
              </button>
              <button
                type="button"
                disabled
                className="btn-neon-ghost px-5 py-2.5 rounded-xl text-xs font-bold font-mono uppercase tracking-wider text-zinc-600 inline-flex items-center gap-2 cursor-not-allowed"
                title="ייפתח לאחר הזנת ואימות מפתח לבורסה"
              >
                <span dir="ltr" className="text-rose-400/60">
                  Live
                </span>
                <Lock className="w-3.5 h-3.5" />
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
                <h4 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-gradient-to-l from-white/10 to-transparent max-w-[80px]" aria-hidden />
                  פוזיציות פעילות — Execution Ledger
                  <span className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent max-w-[80px]" aria-hidden />
                </h4>
                <div
                  className="rounded-2xl border border-white/5 bg-black/30 overflow-x-hidden max-w-full font-mono text-[11px] sm:text-xs"
                  dir="ltr"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 px-3 py-2.5 bg-zinc-900/80 border-b border-white/5 text-[10px] uppercase tracking-widest text-zinc-500 font-sans">
                    <span className="text-start">Instrument</span>
                    <span className="text-end">Entry → Mark</span>
                    <span className="text-end">PnL $</span>
                    <span className="text-end pe-1">Audit</span>
                  </div>
                  <ul className="divide-y divide-white/[0.06]">
                    {activeTrades.map((trade) => {
                      const up = trade.unrealizedPnlUsd >= 0;
                      return (
                        <li
                          key={trade.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 px-3 py-3 items-center hover:bg-white/[0.03] transition-colors"
                        >
                          <span className="text-start font-semibold text-zinc-200 tracking-tight">
                            {trade.symbol.replace('USDT', '')}
                            <span className="text-zinc-600 font-normal">/USDT</span>
                          </span>
                          <span className="text-end text-zinc-500 tabular-nums live-data-number text-[10px] sm:text-xs">
                            {trade.entryPrice.toFixed(2)} → {trade.currentPrice.toFixed(2)}
                          </span>
                          <span
                            className={`text-end font-bold tabular-nums live-data-number ${up ? 'text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.35)]' : 'text-rose-400 drop-shadow-[0_0_10px_rgba(251,113,133,0.3)]'}`}
                          >
                            {up ? '+' : ''}
                            {trade.unrealizedPnlUsd.toFixed(2)}
                          </span>
                          <span className="text-end">
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
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}

            {status.recentExecutions.length > 0 && (
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 mb-3">ביצועים אחרונים</h4>
                <div className="space-y-2 max-h-56 overflow-y-auto pe-1">
                  {status.recentExecutions.map((ev) => (
                    <div
                      key={ev.id}
                      className={`${GLASS_TILE} px-4 py-3 flex flex-wrap items-center justify-between gap-3`}
                      dir="ltr"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono font-bold text-zinc-200">{ev.symbol.replace('USDT', '')}</span>
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                            ev.signal === 'BUY'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-400/25'
                              : 'bg-rose-500/20 text-rose-400 border border-rose-400/25'
                          }`}
                        >
                          {ev.signal}
                        </span>
                        <span className="text-zinc-500 font-mono live-data-number text-xs">{ev.confidence.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            ev.executed ? 'text-emerald-400' : 'text-rose-400/80'
                          }`}
                        >
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div
            dir="rtl"
            className="mx-auto w-full max-w-4xl rounded-3xl border border-white/10 bg-zinc-950/95 backdrop-blur-xl p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="mb-6 border-b border-white/5 pb-5">
              <div className="flex items-start justify-between gap-4">
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
                  onClick={() => setAnalysis(null)}
                  className="btn-neon-ghost rounded-xl px-4 py-2 text-sm font-medium text-zinc-300 transition-colors"
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
