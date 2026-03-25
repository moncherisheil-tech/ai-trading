'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, Cpu, Gauge, Shield, TerminalSquare } from 'lucide-react';

type ExpertWeights = {
  dataExpertWeight: number;
  newsExpertWeight: number;
  macroExpertWeight: number;
};

type ExecutionSnapshot = {
  activeTrades: Array<{
    id: number;
    symbol: string;
    entryPrice: number;
    currentPrice: number;
    amountUsd: number;
    unrealizedPnlUsd: number;
    unrealizedPnlPct: number;
  }>;
  recentExecutions: Array<{
    id: number;
    symbol: string;
    status: string;
    reason: string | null;
    createdAt: string;
  }>;
};

type ClosedTrade = {
  id: number;
  symbol: string;
  closed_at: string | null;
  pnl_net_usd?: number | null;
  pnl_pct?: number | null;
};

type OverseerLog = {
  symbol: string;
  final_confidence: number | null;
  master_insight_he: string | null;
  prediction_date: string;
};

const PANEL =
  'rounded-2xl border border-white/10 bg-black/45 backdrop-blur-xl shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_20px_50px_rgba(0,0,0,0.35)]';

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function weightTone(weight: number): string {
  if (weight > 1) return 'text-emerald-300';
  if (weight < 1) return 'text-rose-300';
  return 'text-cyan-200';
}

function WeightBar({ label, value }: { label: string; value: number }) {
  const normalized = Math.max(0, Math.min(2, value));
  const pct = (normalized / 2) * 100;
  const glow = value > 1 ? 'rgba(16,185,129,0.55)' : value < 1 ? 'rgba(244,63,94,0.45)' : 'rgba(34,211,238,0.45)';
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-[0.18em] text-zinc-400">{label}</span>
        <span className={`text-lg font-semibold tabular-nums ${weightTone(value)}`}>{value.toFixed(2)}x</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-900/90">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, rgba(56,189,248,0.8), ${glow})`,
            boxShadow: `0 0 18px ${glow}`,
          }}
        />
      </div>
    </div>
  );
}

export default function QuantumCommandCenter() {
  const [weights, setWeights] = useState<ExpertWeights>({
    dataExpertWeight: 1,
    newsExpertWeight: 1,
    macroExpertWeight: 1,
  });
  const [execution, setExecution] = useState<ExecutionSnapshot>({ activeTrades: [], recentExecutions: [] });
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [logs, setLogs] = useState<OverseerLog[]>([]);

  const refresh = useCallback(async () => {
    const [weightsRes, executionRes, portfolioRes, logsRes] = await Promise.all([
      fetch('/api/ops/expert-weights', { credentials: 'include', cache: 'no-store' }),
      fetch('/api/trading/execution/status', { credentials: 'include', cache: 'no-store' }),
      fetch('/api/portfolio/virtual', { credentials: 'include', cache: 'no-store' }),
      fetch('/api/ops/overseer-logs', { credentials: 'include', cache: 'no-store' }),
    ]);

    if (weightsRes.ok) {
      const data = (await weightsRes.json()) as { expertWeights?: ExpertWeights };
      if (data.expertWeights) setWeights(data.expertWeights);
    }
    if (executionRes.ok) {
      const data = (await executionRes.json()) as ExecutionSnapshot;
      setExecution({
        activeTrades: data.activeTrades ?? [],
        recentExecutions: data.recentExecutions ?? [],
      });
    }
    if (portfolioRes.ok) {
      const data = (await portfolioRes.json()) as { closedTrades?: ClosedTrade[] };
      setClosedTrades((data.closedTrades ?? []).slice(0, 10));
    }
    if (logsRes.ok) {
      const data = (await logsRes.json()) as { logs?: OverseerLog[] };
      setLogs((data.logs ?? []).slice(0, 20));
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => {
      void refresh();
    }, 0);
    const interval = setInterval(() => {
      void refresh();
    }, 7000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [refresh]);

  const terminalLines = useMemo(() => {
    const analysisLines = logs.slice(0, 8).map((log) => {
      const conf = log.final_confidence != null ? `${log.final_confidence.toFixed(1)}%` : 'n/a';
      return `> OVERSEER ${log.symbol}: Confidence ${conf} · ${log.prediction_date.slice(0, 10)}`;
    });
    const executionLines = execution.recentExecutions.slice(0, 12).map((item) => {
      return `> RISK/TWAP ${item.symbol}: ${item.reason ?? item.status} @ ${new Date(item.createdAt).toLocaleTimeString()}`;
    });
    return [...analysisLines, ...executionLines].slice(0, 18);
  }, [execution.recentExecutions, logs]);

  return (
    <section className="relative min-h-screen overflow-x-hidden bg-[#030307] text-zinc-100" dir="rtl">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(900px 350px at 12% 0%, rgba(6,182,212,0.09), transparent 50%), radial-gradient(800px 320px at 88% 15%, rgba(16,185,129,0.08), transparent 52%), radial-gradient(700px 350px at 50% 100%, rgba(236,72,153,0.06), transparent 48%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-[1700px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className={`${PANEL} flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6`}>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/25 bg-cyan-500/15 shadow-[0_0_25px_rgba(6,182,212,0.25)]">
              <Cpu className="h-6 w-6 text-cyan-300" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-300/75">Quantum Command Center</p>
              <h1 className="text-xl font-bold text-white sm:text-2xl">Quantum AI</h1>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
            Live Neural Telemetry
          </div>
        </header>

        <section className={`${PANEL} p-5 sm:p-6`}>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-cyan-200">
            <Brain className="h-4 w-4" />
            MoE Brain - Expert Trust Weights
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <WeightBar label="Data Expert" value={weights.dataExpertWeight} />
            <WeightBar label="News Expert" value={weights.newsExpertWeight} />
            <WeightBar label="Macro Expert" value={weights.macroExpertWeight} />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className={`${PANEL} overflow-hidden`}>
            <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 text-sm font-semibold text-zinc-200">
              <Gauge className="h-4 w-4 text-cyan-300" />
              Active / Virtual Positions
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-[#090b10]/95 backdrop-blur">
                  <tr className="text-zinc-400">
                    <th className="px-4 py-3 text-right">Asset</th>
                    <th className="px-4 py-3 text-right">Entry</th>
                    <th className="px-4 py-3 text-right">Current</th>
                    <th className="px-4 py-3 text-right">Exposure</th>
                    <th className="px-4 py-3 text-right">Unrealized PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {execution.activeTrades.length === 0 ? (
                    <tr><td className="px-4 py-6 text-center text-zinc-500" colSpan={5}>No open positions.</td></tr>
                  ) : (
                    execution.activeTrades.map((trade) => (
                      <tr key={trade.id} className="border-t border-white/5">
                        <td className="px-4 py-3 font-semibold text-white">{trade.symbol}</td>
                        <td className="px-4 py-3 tabular-nums text-zinc-300">{trade.entryPrice.toFixed(4)}</td>
                        <td className="px-4 py-3 tabular-nums text-cyan-200">{trade.currentPrice.toFixed(4)}</td>
                        <td className="px-4 py-3 tabular-nums text-zinc-300">{formatUsd(trade.amountUsd)}</td>
                        <td className={`px-4 py-3 tabular-nums font-semibold ${trade.unrealizedPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {trade.unrealizedPnlUsd >= 0 ? '+' : ''}{trade.unrealizedPnlUsd.toFixed(2)} ({trade.unrealizedPnlPct.toFixed(2)}%)
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`${PANEL} overflow-hidden`}>
            <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 text-sm font-semibold text-zinc-200">
              <Shield className="h-4 w-4 text-fuchsia-300" />
              Post-Mortem / Closed Trades
            </div>
            <ul className="max-h-[420px] space-y-3 overflow-auto p-4">
              {closedTrades.length === 0 ? (
                <li className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-zinc-500">No closed trades yet.</li>
              ) : (
                closedTrades.map((trade) => {
                  const pnl = trade.pnl_net_usd ?? 0;
                  const rewarded = pnl > 0;
                  return (
                    <li key={trade.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="font-semibold text-white">{trade.symbol}</span>
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${rewarded ? 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border border-rose-500/30 bg-rose-500/15 text-rose-300'}`}>
                          RL: {rewarded ? 'Rewarded' : 'Penalized'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-zinc-400">{trade.closed_at ? new Date(trade.closed_at).toLocaleString() : 'N/A'}</span>
                        <span className={`tabular-nums font-semibold ${pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                          Net {pnl >= 0 ? '+' : ''}{formatUsd(Math.abs(pnl))}
                          {trade.pnl_pct != null ? ` (${trade.pnl_pct.toFixed(2)}%)` : ''}
                        </span>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </section>

        <section className={`${PANEL} overflow-hidden`}>
          <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 text-sm font-semibold text-zinc-200">
            <TerminalSquare className="h-4 w-4 text-amber-300" />
            Overseer Terminal
          </div>
          <div className="relative h-[290px] overflow-auto bg-[#06080c] p-4 font-mono text-xs text-emerald-300/90">
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden
              style={{
                backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 2px, transparent 4px)',
                opacity: 0.12,
              }}
            />
            <div className="relative space-y-2">
              {terminalLines.length === 0 ? (
                <p className="text-zinc-500">Awaiting analysis-core and risk-manager logs...</p>
              ) : (
                terminalLines.map((line, idx) => (
                  <p key={`${line}-${idx}`} className="break-words">{line}</p>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
