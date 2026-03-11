'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import { ArrowLeft, Download, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const LEVERAGE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const STARTING_BALANCE = 10000;

export type PnlTrade = {
  prediction_id: string;
  symbol: string;
  evaluated_at: string;
  date: string;
  predicted_direction: string;
  price_diff_pct: number;
  pnl_usd: number;
  win: boolean;
  risk_status: 'normal' | 'extreme_fear' | 'extreme_greed';
};

export type PnlApiResponse = {
  success: boolean;
  startingBalance: number;
  totalPnl: number;
  totalPnlPct: number;
  winRatePct?: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  equityCurve: { date: string; balance: number; cumulative_pnl: number }[];
  dailyPnl: { date: string; pnl: number }[];
  monthlyPnl?: { month: string; pnl: number }[];
  topStrategies?: { symbol: string; pnl: number; wins: number; count: number }[];
  trades: PnlTrade[];
  totalTrades: number;
};

type PnlTerminalProps = {
  data: PnlApiResponse | null;
};

export default function PnlTerminal({ data }: PnlTerminalProps) {
  const [leverage, setLeverage] = useState<number>(1);
  const [pdfExporting, setPdfExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  if (!data?.success) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-8 text-center text-slate-400">
        Failed to load P&L data. Run evaluations to generate backtest history.
      </div>
    );
  }

  const L = leverage;
  const totalPnl = data.totalPnl * L;
  const totalPnlPct = data.totalPnlPct * L;
  const balance = STARTING_BALANCE + totalPnl;
  const maxDrawdown = data.maxDrawdown * L;
  const winRatePct = data.winRatePct ?? (data.totalTrades > 0 ? (data.trades.filter((t) => t.win).length / data.totalTrades) * 100 : 0);
  const equityCurveScaled = data.equityCurve.map((p) => ({
    ...p,
    balance: STARTING_BALANCE + p.cumulative_pnl * L,
  }));
  const dailyPnlScaled = data.dailyPnl.map((d) => ({ ...d, pnl: d.pnl * L }));
  const monthlyPnlScaled = (data.monthlyPnl ?? []).map((m) => ({ ...m, pnl: m.pnl * L }));
  const tradesScaled = data.trades.map((t) => ({ ...t, pnl_usd: t.pnl_usd * L }));
  const topStrategies = data.topStrategies ?? [];

  const exportPdf = async () => {
    if (!reportRef.current || pdfExporting) return;
    setPdfExporting(true);
    try {
    const canvas = await html2canvas(reportRef.current, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#0f172a',
    });
    const img = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const w = pdf.internal.page.getWidth();
    const h = (canvas.height * w) / canvas.width;
    pdf.addImage(img, 'PNG', 0, 0, w, Math.min(h, 280));
    pdf.addPage();
    pdf.setFontSize(16);
    pdf.text('Mon Chéri Group — Financial Terminal Executive Summary', 20, 20);
    pdf.setFontSize(10);
    pdf.text(`Performance timestamp: ${new Date().toLocaleString()}`, 20, 28);
    pdf.text(`Leverage: ${L}x | Portfolio: $${balance.toFixed(2)} | Net P&L: $${totalPnl.toFixed(2)} (${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%)`, 20, 35);
    pdf.text(`Win Rate: ${winRatePct.toFixed(1)}% | Profit Factor: ${data.profitFactor.toFixed(2)} | Max Drawdown: $${maxDrawdown.toFixed(2)} (${data.maxDrawdownPct.toFixed(1)}%)`, 20, 42);
    if (topStrategies.length > 0) {
      pdf.setFontSize(12);
      pdf.text('Most successful strategies (by P&L):', 20, 52);
      pdf.setFontSize(10);
      topStrategies.slice(0, 5).forEach((s, i) => {
        pdf.text(`${i + 1}. ${s.symbol}: $${s.pnl.toFixed(2)} (${s.wins}/${s.count} wins)`, 22, 60 + i * 6);
      });
    }
    pdf.save(`mon-cheri-pnl-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setPdfExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/ops"
            className="flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Ops
          </Link>
          <h1 className="text-2xl font-bold text-white tracking-tight">Virtual P&L Terminal</h1>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-400">Leverage</label>
            <input
              type="range"
              min={1}
              max={10}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-24 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <select
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="rounded-lg border border-slate-600 bg-slate-800 text-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            >
              {LEVERAGE_OPTIONS.map((x) => (
                <option key={x} value={x}>x{x}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={exportPdf}
            disabled={pdfExporting}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2 text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" /> {pdfExporting ? 'Exporting…' : 'Export Executive Report (PDF)'}
          </button>
        </div>
      </div>

      {/* Core Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Total Portfolio</div>
          <div className="text-2xl font-bold text-white">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="text-xs text-slate-500 mt-0.5">Start $10,000 · {L}x</div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Net Profit (%)</div>
          <div className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            ${totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} ({(totalPnlPct >= 0 ? '+' : '')}{totalPnlPct.toFixed(2)}%)
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Win Rate</div>
          <div className="text-2xl font-bold text-white">{winRatePct.toFixed(1)}%</div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Profit Factor</div>
          <div className="text-2xl font-bold text-white">{data.profitFactor.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Max Drawdown</div>
          <div className="text-2xl font-bold text-red-400">${maxDrawdown.toFixed(2)} ({data.maxDrawdownPct.toFixed(1)}%)</div>
        </div>
      </div>

      {/* Executive summary block — Print Mode layout for PDF (A4 one-page) */}
      <div
        ref={reportRef}
        className="print-mode rounded-xl border border-slate-700 bg-slate-900/80 p-6 space-y-4 max-w-[210mm]"
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-slate-700 border border-slate-600 flex items-center justify-center text-[10px] text-slate-400 font-medium">Mon Chéri Logo</div>
            <div>
              <h2 className="text-lg font-semibold text-white">Mon Chéri Group — Financial Terminal</h2>
              <p className="text-xs text-slate-500">Performance timestamp: {new Date().toLocaleString()}</p>
            </div>
          </div>
          <span className="text-xs text-slate-500">Leverage {L}x</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          <div><span className="text-slate-500">Portfolio</span> <span className="text-white font-medium">${balance.toFixed(2)}</span></div>
          <div><span className="text-slate-500">Net P&L</span> <span className={totalPnl >= 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>${totalPnl.toFixed(2)}</span></div>
          <div><span className="text-slate-500">Win Rate</span> <span className="text-white font-medium">{winRatePct.toFixed(1)}%</span></div>
          <div><span className="text-slate-500">Profit Factor</span> <span className="text-white font-medium">{data.profitFactor.toFixed(2)}</span></div>
          <div><span className="text-slate-500">Max DD</span> <span className="text-red-400 font-medium">${maxDrawdown.toFixed(2)}</span></div>
        </div>
        {topStrategies.length > 0 && (
          <div className="pt-2 border-t border-slate-700">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Most successful strategies</h3>
            <ul className="text-sm text-slate-300 space-y-1">
              {topStrategies.slice(0, 5).map((s, i) => (
                <li key={s.symbol}>{i + 1}. {s.symbol}: ${s.pnl.toFixed(2)} ({s.wins}/{s.count} wins)</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Equity Curve</h3>
          <div className="h-64">
            {equityCurveScaled.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurveScaled}>
                  <defs>
                    <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#475569" />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#475569" tickFormatter={(v) => `$${v.toLocaleString()}`} width={70} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Balance']} labelFormatter={(l) => `Date: ${l}`} />
                  <Area type="monotone" dataKey="balance" stroke="#f59e0b" strokeWidth={2} fill="url(#equityGradient)" name="Balance" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">No equity data yet.</div>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-5">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Daily / Monthly Performance</h3>
          <div className="h-64">
            {(dailyPnlScaled.length > 0 || monthlyPnlScaled.length > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyPnlScaled.length >= 3 ? monthlyPnlScaled : dailyPnlScaled}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey={monthlyPnlScaled.length >= 3 ? 'month' : 'date'} tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#475569" />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#475569" tickFormatter={(v) => `$${v}`} width={60} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} formatter={(v: number) => [`$${v.toFixed(2)}`, 'P&L']} />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]} name="P&L">
                    {(monthlyPnlScaled.length >= 3 ? monthlyPnlScaled : dailyPnlScaled).map((entry: { pnl: number }, i: number) => (
                      <Cell key={i} fill={entry.pnl >= 0 ? '#22c55e' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">No P&L data yet.</div>
            )}
          </div>
        </div>
      </div>

      {/* Trade Log */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/80 overflow-hidden">
        <h3 className="text-sm font-semibold text-slate-300 px-5 py-4 border-b border-slate-700">Last 20 Trades</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left py-3 px-4 text-slate-400 font-medium">Date</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium">Symbol</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium">Direction</th>
                <th className="text-right py-3 px-4 text-slate-400 font-medium">P&L ($)</th>
                <th className="text-center py-3 px-4 text-slate-400 font-medium">Win/Loss</th>
                <th className="text-center py-3 px-4 text-slate-400 font-medium">Risk Status</th>
              </tr>
            </thead>
            <tbody>
              {tradesScaled.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-500">No trades yet.</td></tr>
              ) : (
                tradesScaled.map((t) => (
                  <tr key={t.prediction_id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="py-2.5 px-4 text-slate-300">{new Date(t.evaluated_at).toLocaleString()}</td>
                    <td className="py-2.5 px-4 font-medium text-white">{t.symbol}</td>
                    <td className="py-2.5 px-4 text-slate-300">{t.predicted_direction}</td>
                    <td className={`py-2.5 px-4 text-right font-medium ${t.pnl_usd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.pnl_usd >= 0 ? '+' : ''}{t.pnl_usd.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      {t.win ? <TrendingUp className="w-4 h-4 text-emerald-400 inline" /> : <TrendingDown className="w-4 h-4 text-red-400 inline" />}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      {t.risk_status === 'extreme_fear' && <span className="inline-flex items-center gap-1 text-xs bg-amber-900/50 text-amber-400 px-2 py-0.5 rounded"><AlertTriangle className="w-3 h-3" /> Fear</span>}
                      {t.risk_status === 'extreme_greed' && <span className="inline-flex items-center gap-1 text-xs bg-amber-900/50 text-amber-400 px-2 py-0.5 rounded"><AlertTriangle className="w-3 h-3" /> Greed</span>}
                      {t.risk_status === 'normal' && <span className="text-slate-500 text-xs">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
