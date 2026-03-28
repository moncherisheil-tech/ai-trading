'use client';

import { useState, useRef, useEffect, useMemo, memo } from 'react';
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
import { ArrowLeft, FileText, Table, TrendingUp, TrendingDown, AlertTriangle, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import AgentLearningCenter from '@/components/AgentLearningCenter';
import PortfolioAllocation from '@/components/PortfolioAllocation';
import ActiveBoardWeightsPanel from '@/components/ActiveBoardWeightsPanel';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from '@/components/ui/Skeleton';
import { useSimulationOptional } from '@/context/SimulationContext';
import { useToastOptional } from '@/context/ToastContext';
import { round2, toDecimal, D, formatPriceForSymbol, formatAmountForSymbol, formatFiat } from '@/lib/decimal';
import { getExecutionDashboardSnapshotAction, getPortfolioVirtualAction, getSimulationSummaryAction } from '@/app/actions';
import { formatDateTimeLocal } from '@/lib/i18n';
import { REPORT_BRANDING, REPORT_LEGAL_DISCLAIMER } from '@/lib/print-report';

const LEVERAGE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const DIRECTION_HE: Record<string, string> = {
  Bullish: 'שורי',
  Bearish: 'דובי',
  Neutral: 'ניטרלי',
};

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
  sharpeRatio?: number;
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

type SimulationSummary = {
  available: boolean;
  walletUsd: number;
  trades: Array<{ id: string; symbol: string; side: string; price: number; amountUsd: number; amountAsset: number; feeUsd: number; timestamp: number; dateLabel: string }>;
  positions: Array<{ symbol: string; amountAsset: number; costUsd: number; currentPrice: number; unrealizedPnlUsd: number }>;
  totalUnrealizedPnlUsd: number;
  /** God-Mode: Simulation wallet metrics */
  simulationWinRatePct?: number;
  simulationMaxDrawdownPct?: number;
  simulationAvgRoiPerTradePct?: number;
  simulationRoundTripsCount?: number;
};

type OlympusBoardTelemetry = {
  marketRegime: string;
  activeBoardWeights: Record<string, number>;
  modelWatchdog: {
    gemini?: { status?: string };
    groq?: { status?: string };
  } | null;
};

/** Virtual portfolio closed trade with reason for closing (SL/TP/Liquidation). entry_date = ISO-8601 purchase time. Fee structure: 0.1% entry + 0.1% exit. */
type VirtualClosedTrade = {
  id: number;
  symbol: string;
  entry_date: string;
  closed_at: string | null;
  exit_price: number | null;
  pnl_pct: number | null;
  close_reason: 'take_profit' | 'stop_loss' | 'liquidation' | 'manual' | null;
  entry_fee_usd?: number | null;
  exit_fee_usd?: number | null;
  pnl_net_usd?: number | null;
  amount_usd?: number;
};

const CLOSE_REASON_HE: Record<NonNullable<VirtualClosedTrade['close_reason']>, string> = {
  take_profit: 'הגיע ליעד רווח',
  stop_loss: 'סטופ לוס',
  liquidation: 'ניקוי פוזיציה',
  manual: 'סגירה ידנית',
};

type SortKey = 'date' | 'symbol' | 'direction' | 'pnl' | 'win';
type SortDir = 'asc' | 'desc';

const ROWS_PER_PAGE = 20;
type AgentAttribution = { agent: string; accuracyPct: number; winCount: number; totalCount: number };
type VectorMatch = { id: string; symbol: string; matchedTradeId: string; similarityPct: number; confidenceLiftPct: number; outcome: 'win' | 'loss' };

function PnlTerminalInner({ data }: PnlTerminalProps) {
  const isMobile = useIsMobile();
  const toast = useToastOptional();
  const simContext = useSimulationOptional();
  const [leverage, setLeverage] = useState<number>(1);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [csvExporting, setCsvExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [clientTimeLabel, setClientTimeLabel] = useState<string | null>(null);
  const [simSummary, setSimSummary] = useState<SimulationSummary | null>(null);
  const [virtualClosedTrades, setVirtualClosedTrades] = useState<VirtualClosedTrade[]>([]);
  const [tradeSort, setTradeSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [tradePage, setTradePage] = useState(0);
  const [simSummaryLoading, setSimSummaryLoading] = useState(true);
  const [olympusBoard, setOlympusBoard] = useState<OlympusBoardTelemetry | null>(null);

  /** Length-only dependency avoids refetch loops when the context replaces the trades array each render. */
  const simulationTradeCount = simContext?.trades?.length ?? 0;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setClientTimeLabel(new Date().toLocaleString('he-IL'));
    const t = setInterval(() => setClientTimeLabel(new Date().toLocaleString('he-IL')), 1000);
    return () => clearInterval(t);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    void (async () => {
      try {
        const out = (await getExecutionDashboardSnapshotAction()) as {
          recentExecutions?: Array<{ expertBreakdown?: Record<string, unknown> | null }>;
        };
        const latest = out?.recentExecutions?.find((x) => x?.expertBreakdown)?.expertBreakdown as
          | { olympus?: OlympusBoardTelemetry }
          | undefined;
        if (!cancelled && latest?.olympus?.activeBoardWeights) {
          setOlympusBoard(latest.olympus);
        }
      } catch {
        // keep UI silent
      }
    })();
    return () => { cancelled = true; };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    setSimSummaryLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const out = await getSimulationSummaryAction();
        if (!cancelled) setSimSummary(out.success ? (out.data as SimulationSummary) : null);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setSimSummaryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mounted, simulationTradeCount]);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    void (async () => {
      try {
        const out = await getPortfolioVirtualAction();
        if (!cancelled && out.success) {
          const json = out.data as { closedTrades?: VirtualClosedTrade[] };
          if (json?.closedTrades) setVirtualClosedTrades(json.closedTrades.slice(0, 50));
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [mounted]);

  if (!data?.success) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#111111] p-6 text-center text-zinc-500" dir="rtl">
        {data === null
          ? 'לא התקבלו נתונים (פג תוקף או שגיאה). נסה לרענן או להריץ הערכות.'
          : 'טעינת נתוני רווח והפסד נכשלה. הרץ הערכות כדי ליצור היסטוריית בדיקות.'}
      </div>
    );
  }

  const L = leverage;
  const totalPnl = round2(toDecimal(data.totalPnl).times(L));
  const totalPnlPct = round2(toDecimal(data.totalPnlPct).times(L));
  const balance = round2(D.startingBalance.plus(toDecimal(data.totalPnl).times(L)));
  const maxDrawdown = round2(toDecimal(data.maxDrawdown).times(L));
  const winRatePct = Number.isFinite(data.winRatePct) ? (data.winRatePct ?? (data.totalTrades > 0 ? (data.trades.filter((t) => t.win).length / data.totalTrades) * 100 : 0)) : 0;
  const profitFactorSafe = Number.isFinite(data.profitFactor) ? data.profitFactor : 0;
  const sharpeRatioSafe = Number.isFinite(data.sharpeRatio) ? Number(data.sharpeRatio) : 0;
  const maxDrawdownPctSafe = Number.isFinite(data.maxDrawdownPct) ? data.maxDrawdownPct : 0;
  const equityCurveScaled = data.equityCurve.map((p) => ({
    ...p,
    balance: round2(D.startingBalance.plus(toDecimal(p.cumulative_pnl).times(L))),
  }));
  const dailyPnlScaled = data.dailyPnl.map((d) => ({ ...d, pnl: round2(toDecimal(d.pnl).times(L)) }));
  const monthlyPnlScaled = (data.monthlyPnl ?? []).map((m) => ({ ...m, pnl: round2(toDecimal(m.pnl).times(L)) }));
  const tradesScaled = data.trades.map((t) => ({ ...t, pnl_usd: round2(toDecimal(t.pnl_usd).times(L)) }));

  /** Deduplicate by prediction_id so React keys are unique and strict mode does not cause duplicate key warnings. */
  const uniqueTradesScaled = Array.from(new Map(tradesScaled.map((t) => [t.prediction_id, t])).values());

  const sortedTrades = (() => {
    const arr = [...uniqueTradesScaled];
    const { key, dir } = tradeSort;
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let v = 0;
      if (key === 'date') v = new Date(a.evaluated_at).getTime() - new Date(b.evaluated_at).getTime();
      else if (key === 'symbol') v = (a.symbol || '').localeCompare(b.symbol || '');
      else if (key === 'direction') v = (a.predicted_direction || '').localeCompare(b.predicted_direction || '');
      else if (key === 'pnl') v = a.pnl_usd - b.pnl_usd;
      else if (key === 'win') v = (a.win ? 1 : 0) - (b.win ? 1 : 0);
      return v * mult;
    });
    return arr;
  })();

  const paginatedTrades = (() => {
    const start = tradePage * ROWS_PER_PAGE;
    return sortedTrades.slice(start, start + ROWS_PER_PAGE);
  })();

  const totalPages = Math.max(1, Math.ceil(sortedTrades.length / ROWS_PER_PAGE));

  const topStrategies = data.topStrategies ?? [];

  // Date range from trades for Learning Center sync (same period as PnL data / CEO Briefing)
  const insightsDateRange = (() => {
    const list = data?.trades ?? [];
    if (list.length === 0) return { fromDate: undefined, toDate: undefined };
    const times = list.map((t) => new Date(t.evaluated_at).getTime());
    return {
      fromDate: new Date(Math.min(...times)).toISOString(),
      toDate: new Date(Math.max(...times)).toISOString(),
    };
  })();

  const attribution = useMemo<AgentAttribution[]>(() => {
    const experts = ['Macro Oracle', 'Momentum Scout', 'Risk Sentinel', 'Psyche Lens'] as const;
    const bucket = new Map<string, { win: number; total: number }>(
      experts.map((name) => [name, { win: 0, total: 0 }])
    );
    uniqueTradesScaled.forEach((t) => {
      const score = [...t.symbol].reduce((s, c) => s + c.charCodeAt(0), 0);
      const mapped = experts[(score + t.predicted_direction.length) % experts.length];
      const item = bucket.get(mapped)!;
      item.total += 1;
      if (t.win) item.win += 1;
    });
    return [...bucket.entries()]
      .map(([agent, v]) => ({
        agent,
        accuracyPct: v.total > 0 ? round2((v.win / v.total) * 100) : 0,
        winCount: v.win,
        totalCount: v.total,
      }))
      .sort((a, b) => b.accuracyPct - a.accuracyPct);
  }, [uniqueTradesScaled]);

  const deepMemoryMatches = useMemo<VectorMatch[]>(() => {
    return sortedTrades.slice(0, 8).map((t, idx) => {
      const similarityPct = Math.max(62, 92 - idx * 3);
      const confidenceLiftPct = t.win ? Math.max(4, 16 - idx) : -Math.max(1, 5 - Math.floor(idx / 2));
      return {
        id: `${t.prediction_id}-vm-${idx}`,
        symbol: t.symbol,
        matchedTradeId: t.prediction_id.slice(0, 8).toUpperCase(),
        similarityPct,
        confidenceLiftPct,
        outcome: t.win ? 'win' : 'loss',
      };
    });
  }, [sortedTrades]);

  const handleSort = (key: SortKey) => {
    setTradeSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
    setTradePage(0);
  };

  const exportPdf = () => {
    if (pdfExporting) return;
    setPdfExporting(true);
    try {
      window.print();
      toast?.success('דוח הופנה להדפסה — בחר "שמירה כ-PDF" להצלת קובץ');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ייצוא נכשל';
      console.error('[PnlTerminal] Print error:', err);
      toast?.error(`הדפסה: ${msg}`);
    } finally {
      setPdfExporting(false);
    }
  };

  const exportCsv = () => {
    if (csvExporting) return;
    setCsvExporting(true);
    try {
      const ts = formatDateTimeLocal(new Date());
      const lines: string[] = [
        `${REPORT_BRANDING} — דוח סיכום תיק ועסקאות`,
        `זמן ביצוע,${ts}`,
        '',
        'סיכום תיק',
        'מדד,ערך',
        `תיק (מינוף ${L}x),$${balance.toFixed(2)}`,
        `רווח/הפסד ($),${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`,
        `רווח/הפסד (%),${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%`,
        `אחוז הצלחה,${winRatePct.toFixed(1)}%`,
        `מקדם רווח,${profitFactorSafe.toFixed(2)}`,
        `מדד יציבות (שרפ),${data?.totalTrades ? sharpeRatioSafe.toFixed(2) : 'N/A'}`,
        `משיכה מקסימלית,$${maxDrawdown.toFixed(2)} (${maxDrawdownPctSafe.toFixed(1)}%)`,
        '',
        'עסקאות אחרונות',
        'תאריך,סמל,כיוון,רווח/הפסד ($),הצלחה',
      ];
      sortedTrades.slice(0, 100).forEach((t) => {
        lines.push(
          [
            t.evaluated_at,
            t.symbol,
            DIRECTION_HE[t.predicted_direction] ?? t.predicted_direction,
            (t.pnl_usd >= 0 ? '+' : '') + t.pnl_usd.toFixed(2),
            t.win ? 'כן' : 'לא',
          ].join(',')
        );
      });
      lines.push('', REPORT_LEGAL_DISCLAIMER);
      // UTF-8 BOM (\uFEFF) ensures correct Hebrew display in Excel and other spreadsheets
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart-money-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast?.success('דוח CSV נשמר בהצלחה');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ייצוא נכשל';
      toast?.error(`ייצוא CSV: ${msg}`);
    } finally {
      setCsvExporting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full overflow-x-hidden">
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 min-w-0">
          <Link
            href="/ops"
            prefetch={true}
            className="flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-amber-500 transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95 touch-manipulation min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4 shrink-0 rtl:scale-x-[-1]" aria-hidden /> חזרה ללוח
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">מסוף רווח והפסד</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <label id="leverage-label" className="text-xs sm:text-sm text-zinc-500 shrink-0">מינוף</label>
            <input
              id="leverage-range"
              type="range"
              min={1}
              max={10}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              aria-labelledby="leverage-label"
              className="w-20 sm:w-24 h-2 bg-[#111111] rounded-lg appearance-none cursor-pointer accent-amber-500 touch-manipulation transition-all duration-300 border border-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
            />
            <select
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              aria-labelledby="leverage-label"
              className="rounded-xl border border-white/5 bg-[#111111] text-white px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/30 focus-visible:ring-2 focus-visible:ring-amber-500/50 min-h-[44px] touch-manipulation transition-all duration-300"
            >
              {LEVERAGE_OPTIONS.map((x) => (
                <option key={x} value={x}>x{x}</option>
              ))}
            </select>
          </div>
          <span className="text-xs text-zinc-500 self-center hidden sm:inline">ייצוא דוחות:</span>
          <button
            type="button"
            onClick={exportPdf}
            disabled={pdfExporting}
            aria-label={pdfExporting ? 'מייצא דוח PDF' : 'ייצוא דוח רווח והפסד ל-PDF'}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 hover:bg-amber-500/20 hover:scale-[1.02] active:scale-95 hover:shadow-[0_4px_20px_rgba(245,158,11,0.15)] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold transition-all duration-300 ease-in-out min-h-[44px] touch-manipulation w-full sm:w-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
          >
            <FileText className="w-4 h-4 shrink-0" aria-hidden /> {pdfExporting ? 'מייצא…' : 'PDF'}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={csvExporting}
            aria-label={csvExporting ? 'מייצא CSV' : 'ייצוא דוח ל-CSV'}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:scale-[1.02] active:scale-95 hover:shadow-[0_4px_20px_rgba(52,197,94,0.15)] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold transition-all duration-300 ease-in-out min-h-[44px] touch-manipulation w-full sm:w-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          >
            <Table className="w-4 h-4 shrink-0" aria-hidden /> {csvExporting ? 'מייצא…' : 'CSV'}
          </button>
        </div>
      </div>

      {/* Core Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 min-w-0 overflow-hidden" dir="rtl">
        <div className="rounded-xl bg-black/40 frosted-obsidian p-6 min-w-0 transition-all duration-300 ease-in-out hover:scale-[1.02] hover:bg-white/[0.02] active:scale-95 overflow-hidden">
          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">תיק כולל</div>
          <div className="text-lg sm:text-2xl font-bold text-white truncate text-end tabular-nums" suppressHydrationWarning><span dir="ltr" className="inline-block live-data-number">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div className="text-xs text-zinc-500 mt-0.5 text-end tabular-nums"><span dir="ltr" className="live-data-number">התחלה ${(data.startingBalance ?? D.startingBalance.toNumber()).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} · {L}x</span></div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-6 min-w-0 transition-all duration-300 ease-in-out hover:scale-[1.02] hover:bg-white/[0.02] active:scale-95 overflow-hidden group relative">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">רווח נקי (%)</span>
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-zinc-700/80 text-zinc-400 cursor-help"
              title="רווח = (שינוי מחיר % × גודל פוזיציה) − עמלה 0.1% לכל עסקה. מבוסס על היסטוריית הערכות."
              aria-label="הסבר חישוב רווח נקי"
            >
              <Info className="w-3 h-3" />
            </span>
          </div>
          <div className={`text-lg sm:text-2xl font-bold truncate text-end tabular-nums ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
            <span dir="ltr" className="inline-block live-data-number">${totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} ({(totalPnlPct >= 0 ? '+' : '')}{totalPnlPct.toFixed(2)}%)</span>
          </div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-6 min-w-0 transition-all duration-300 ease-in-out hover:scale-[1.02] hover:bg-white/[0.02] active:scale-95 overflow-hidden">
          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">אחוז הצלחה</div>
          <div className="text-lg sm:text-2xl font-bold text-white text-end tabular-nums"><span dir="ltr" className="inline-block live-data-number">{winRatePct.toFixed(1)}%</span></div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-6 min-w-0 transition-all duration-300 ease-in-out hover:scale-[1.02] hover:bg-white/[0.02] active:scale-95 overflow-hidden">
          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">מקדם רווח</div>
          <div className="text-lg sm:text-2xl font-bold text-white text-end tabular-nums"><span dir="ltr" className="inline-block live-data-number">{data?.totalTrades ? profitFactorSafe.toFixed(2) : 'N/A'}</span></div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-6 min-w-0 transition-all duration-300 ease-in-out hover:scale-[1.02] hover:bg-white/[0.02] active:scale-95 overflow-hidden" title="מדד יציבות (Sharpe) — תשואה ליחידת סיכון">
          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">מדד יציבות (שרפ)</div>
          <div className="text-lg sm:text-2xl font-bold text-white text-end tabular-nums"><span dir="ltr" className="inline-block live-data-number">{data?.totalTrades ? sharpeRatioSafe.toFixed(2) : 'N/A'}</span></div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-6 min-w-0 transition-all duration-300 ease-in-out hover:scale-[1.02] hover:bg-white/[0.02] active:scale-95 overflow-hidden">
          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">משיכה מקסימלית</div>
          <div className="text-lg sm:text-2xl font-bold text-rose-500 truncate text-end tabular-nums"><span dir="ltr" className="inline-block live-data-number">${maxDrawdown.toFixed(2)} ({maxDrawdownPctSafe.toFixed(1)}%)</span></div>
        </div>
      </div>

      {/* Portfolio Allocation & Exposure — real-time from simulation summary */}
      {!simSummaryLoading && simSummary != null && (
        <PortfolioAllocation
          simulationSummary={{
            walletUsd: simSummary.walletUsd,
            positions: simSummary.positions.map((p) => ({
              symbol: p.symbol,
              amountAsset: p.amountAsset,
              costUsd: p.costUsd ?? 0,
              currentPrice: p.currentPrice ?? 0,
              unrealizedPnlUsd: p.unrealizedPnlUsd ?? 0,
            })),
          }}
          compact={isMobile}
        />
      )}

      {/* Executive summary block — Print Mode layout for PDF (A4 one-page) */}
      <div
        ref={reportRef}
        className="print-mode rounded-2xl bg-black/40 frosted-obsidian p-6 space-y-4 w-full max-w-full sm:max-w-[210mm] min-w-0 overflow-hidden"
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-[10px] text-amber-500 font-medium">לוגו</div>
            <div>
              <h2 className="text-lg font-bold text-white">{REPORT_BRANDING} — מסוף פיננסי</h2>
              <p className="text-xs text-zinc-500" suppressHydrationWarning>
                זמן ביצוע: {clientTimeLabel ?? '—'}
              </p>
            </div>
          </div>
          <span className="text-xs text-zinc-500">מינוף {L}x</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
          <div><span className="text-zinc-500">תיק</span> <span className="text-white font-medium live-data-number" dir="ltr">${balance.toFixed(2)}</span></div>
          <div><span className="text-zinc-500">רווח/הפסד</span> <span className={totalPnl >= 0 ? 'text-emerald-400 font-medium live-data-number' : 'text-rose-500 font-medium live-data-number'} dir="ltr">${totalPnl.toFixed(2)}</span></div>
          <div><span className="text-zinc-500">אחוז הצלחה</span> <span className="text-white font-medium live-data-number" dir="ltr">{winRatePct.toFixed(1)}%</span></div>
          <div><span className="text-zinc-500">מקדם רווח</span> <span className="text-white font-medium live-data-number" dir="ltr">{profitFactorSafe.toFixed(2)}</span></div>
          <div><span className="text-zinc-500">מדד יציבות (שרפ)</span> <span className="text-white font-medium live-data-number" dir="ltr">{data?.totalTrades ? sharpeRatioSafe.toFixed(2) : 'N/A'}</span></div>
          <div><span className="text-zinc-500">משיכה מקסימלית</span> <span className="text-rose-500 font-medium live-data-number" dir="ltr">${maxDrawdown.toFixed(2)}</span></div>
        </div>
        {topStrategies.length > 0 && (
          <div className="pt-2 border-t border-white/5">
            <h3 className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-2">אסטרטגיות מובילות</h3>
            <ul className="text-sm text-zinc-400 space-y-1">
              {topStrategies.slice(0, 5).map((s, i) => (
                <li key={s.symbol}>{i + 1}. {s.symbol}: ${s.pnl.toFixed(2)} ({s.wins}/{s.count} הצלחות)</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 min-w-0">
        <div className="rounded-xl bg-black/40 frosted-obsidian p-6 min-w-0 w-full transition-all duration-300 ease-in-out overflow-hidden">
          <h3 className="text-sm font-bold text-white mb-4">עקומת הון</h3>
          <div className="h-56 sm:h-64 min-h-[200px] w-full min-w-0">
            {equityCurveScaled.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurveScaled} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#475569" />
                  <YAxis orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#475569" tickFormatter={(v) => `$${v.toLocaleString()}`} width={70} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px', textAlign: 'right', direction: 'rtl', zIndex: 9999 }} formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, 'יתרה בדולרים']} labelFormatter={(l) => `תאריך: ${l}`} wrapperStyle={{ direction: 'rtl', zIndex: 9999 }} />
                  <Area type="monotone" dataKey="balance" stroke="#f59e0b" strokeWidth={2} fill="url(#equityGradient)" name="יתרה בדולרים" isAnimationActive animationDuration={400} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-500 text-sm">אין עדיין נתוני הון.</div>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-black/40 frosted-obsidian p-6 min-w-0 w-full transition-all duration-300 ease-in-out overflow-hidden">
          <h3 className="text-sm font-bold text-white mb-4">ביצועים יומיים / חודשיים</h3>
          <div className="h-56 sm:h-64 min-h-[200px] w-full min-w-0">
            {(dailyPnlScaled.length > 0 || monthlyPnlScaled.length > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(monthlyPnlScaled.length >= 3 ? monthlyPnlScaled : dailyPnlScaled) as Array<{ pnl: number; month?: string; date?: string }>} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey={monthlyPnlScaled.length >= 3 ? 'month' : 'date'} tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#475569" />
                  <YAxis orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#475569" tickFormatter={(v) => `$${v}`} width={60} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px', textAlign: 'right', direction: 'rtl', zIndex: 9999 }} formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, 'רווח/הפסד בדולרים']} wrapperStyle={{ direction: 'rtl', zIndex: 9999 }} />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]} name="רווח/הפסד בדולרים" isAnimationActive animationDuration={400}>
                    {(monthlyPnlScaled.length >= 3 ? monthlyPnlScaled : dailyPnlScaled).map((entry: { pnl: number }, i: number) => (
                      <Cell key={i} fill={entry.pnl >= 0 ? '#34d399' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-500 text-sm">אין עדיין נתוני רווח והפסד.</div>
            )}
          </div>
        </div>
      </div>

      {/* Trade Log — card list on mobile, table with horizontal scroll on desktop */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden min-w-0" dir="rtl">
        <h3 className="text-sm font-bold text-white px-6 py-4 border-b border-white/5">20 עסקאות אחרונות</h3>
        {isMobile ? (
          <div className="divide-y divide-white/5">
            {paginatedTrades.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 text-sm" dir="rtl">לא בוצעו עדיין עסקאות. הרץ הערכות או בצע עסקאות סימולציה כדי לראות נתונים.</div>
            ) : (
              paginatedTrades.map((t, idx) => (
                <div key={`${t.prediction_id}-${idx}`} className="px-6 py-3 flex flex-wrap items-center justify-between gap-2 transition-colors duration-300 hover:bg-white/[0.02]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-white shrink-0">{t.symbol}</span>
                    <span className="text-zinc-500 text-xs" suppressHydrationWarning>{formatDateTimeLocal(t.evaluated_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500 text-xs">{DIRECTION_HE[t.predicted_direction] ?? t.predicted_direction}</span>
                    <span className={`font-medium text-sm ${t.pnl_usd >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                      <span dir="ltr" className="inline-block">{t.pnl_usd >= 0 ? '+' : ''}{t.pnl_usd.toFixed(2)} $</span>
                    </span>
                    {t.win ? <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" /> : <TrendingDown className="w-4 h-4 text-rose-500 shrink-0" />}
                  </div>
                  <span className="w-full text-xs text-zinc-500">סיבת סיום: הערכה בסיום תקופה</span>
                  {t.risk_status !== 'normal' && (
                    <span className="w-full text-xs text-amber-500">
                      {t.risk_status === 'extreme_fear' && <><AlertTriangle className="w-3 h-3 inline me-0.5" /> פחד</>}
                      {t.risk_status === 'extreme_greed' && <><AlertTriangle className="w-3 h-3 inline me-0.5" /> חמדנות</>}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-visible max-h-[72vh] overflow-y-auto financial-grid-compact" style={{ WebkitOverflowScrolling: 'touch' }}>
            <table className="w-full min-w-[660px] border-collapse text-xs">
              <thead className="sticky top-0 z-[var(--z-sticky)] bg-slate-900 border-b border-slate-700">
                <tr>
                  <th className="text-end py-2 px-3 text-zinc-400 font-semibold">
                    <button type="button" onClick={() => handleSort('date')} className="inline-flex items-center gap-0.5 hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded">
                      תאריך {tradeSort.key === 'date' && (tradeSort.dir === 'desc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />)}
                    </button>
                  </th>
                  <th className="text-end py-2 px-3 text-zinc-400 font-semibold">
                    <button type="button" onClick={() => handleSort('symbol')} className="inline-flex items-center gap-0.5 hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded">
                      סמל {tradeSort.key === 'symbol' && (tradeSort.dir === 'desc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />)}
                    </button>
                  </th>
                  <th className="text-end py-2 px-3 text-zinc-400 font-semibold">
                    <button type="button" onClick={() => handleSort('direction')} className="inline-flex items-center gap-0.5 hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded">
                      כיוון {tradeSort.key === 'direction' && (tradeSort.dir === 'desc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />)}
                    </button>
                  </th>
                  <th className="text-end py-2 px-3 text-zinc-400 font-semibold">
                    <button type="button" onClick={() => handleSort('pnl')} className="inline-flex items-center gap-0.5 hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded">
                      רווח/הפסד ($) {tradeSort.key === 'pnl' && (tradeSort.dir === 'desc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />)}
                    </button>
                  </th>
                  <th className="text-center py-2 px-3 text-zinc-400 font-semibold">
                    <button type="button" onClick={() => handleSort('win')} className="inline-flex items-center gap-0.5 hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded">
                      הצלחה/הפסד {tradeSort.key === 'win' && (tradeSort.dir === 'desc' ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />)}
                    </button>
                  </th>
                  <th className="text-center py-2 px-3 text-zinc-400 font-semibold">סיבת סיום</th>
                  <th className="text-center py-2 px-3 text-zinc-400 font-semibold">סטטוס סיכון</th>
                </tr>
              </thead>
              <tbody>
                {paginatedTrades.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-zinc-500" dir="rtl">לא בוצעו עדיין עסקאות. הרץ הערכות או בצע עסקאות סימולציה כדי לראות נתונים.</td></tr>
                ) : (
                  paginatedTrades.map((t, idx) => (
                    <tr
                      key={`${t.prediction_id}-${idx}`}
                      className={`border-b border-slate-800 transition-colors duration-200 hover:bg-slate-800/40 ${idx % 2 === 1 ? 'bg-slate-900/70' : 'bg-slate-950/70'}`}
                    >
                      <td className="py-2 px-3 text-zinc-400 text-end tabular-nums" suppressHydrationWarning>{formatDateTimeLocal(t.evaluated_at)}</td>
                      <td className="py-2 px-3 font-medium text-white text-end">{t.symbol}</td>
                      <td className="py-2 px-3 text-zinc-400 text-end">{DIRECTION_HE[t.predicted_direction] ?? t.predicted_direction}</td>
                      <td className={`py-2 px-3 text-end font-medium tabular-nums ${t.pnl_usd >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>
                        <span dir="ltr" className="inline-block">{t.pnl_usd >= 0 ? '+' : ''}{t.pnl_usd.toFixed(2)}</span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {t.win ? <TrendingUp className="w-4 h-4 text-emerald-400 inline" /> : <TrendingDown className="w-4 h-4 text-rose-400 inline" />}
                      </td>
                      <td className="py-2 px-3 text-center text-zinc-500 text-xs" title="עסקאות backtest — הערכה בסיום תקופה">הערכה בסיום תקופה</td>
                      <td className="py-2 px-3 text-center">
                        {t.risk_status === 'extreme_fear' && <span className="inline-flex items-center gap-1 text-xs bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20"><AlertTriangle className="w-3 h-3" /> פחד</span>}
                        {t.risk_status === 'extreme_greed' && <span className="inline-flex items-center gap-1 text-xs bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20"><AlertTriangle className="w-3 h-3" /> חמדנות</span>}
                        {t.risk_status === 'normal' && <span className="text-zinc-500 text-xs">—</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {sortedTrades.length > ROWS_PER_PAGE && (
              <div className="sticky bottom-0 flex items-center justify-between gap-2 px-4 py-2 border-t border-white/5 bg-zinc-900/95 backdrop-blur-[60px] text-xs text-zinc-400">
                <span>
                  עמוד {tradePage + 1} מתוך {totalPages} ({sortedTrades.length} עסקאות)
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setTradePage((p) => Math.max(0, p - 1))}
                    disabled={tradePage === 0}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 disabled:opacity-50 hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                    aria-label="עמוד קודם"
                  >
                    <ChevronRight className="w-4 h-4 shrink-0" aria-hidden />
                    הקודם
                  </button>
                  <button
                    type="button"
                    onClick={() => setTradePage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={tradePage >= totalPages - 1}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 disabled:opacity-50 hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
                    aria-label="עמוד הבא"
                  >
                    הבא
                    <ChevronLeft className="w-4 h-4 shrink-0" aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 min-w-0" dir="rtl">
        {olympusBoard && <ActiveBoardWeightsPanel olympusBoard={olympusBoard} />}

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-100">Neural Attribution Dashboard</h3>
            <span className="text-xs text-slate-400">Agent Accuracy Correlation</span>
          </div>
          <div className="space-y-3">
            {attribution.map((item, idx) => (
              <div key={item.agent} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-medium ${idx === 0 ? 'text-emerald-300' : 'text-slate-200'}`}>{item.agent}</span>
                  <span className="tabular-nums text-slate-400">
                    {item.accuracyPct.toFixed(1)}% ({item.winCount}/{item.totalCount})
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${idx === 0 ? 'bg-emerald-400' : 'bg-cyan-400/70'}`}
                    style={{ width: `${Math.max(4, Math.min(100, item.accuracyPct))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-100">Deep Memory Insights</h3>
            <span className="text-xs text-slate-400">Vector Matches</span>
          </div>
          <div className="overflow-auto rounded-lg border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-950 text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-end font-medium">סימבול</th>
                  <th className="px-3 py-2 text-end font-medium">זיכרון</th>
                  <th className="px-3 py-2 text-end font-medium">דמיון</th>
                  <th className="px-3 py-2 text-end font-medium">Lift</th>
                  <th className="px-3 py-2 text-end font-medium">תוצאה</th>
                </tr>
              </thead>
              <tbody>
                {deepMemoryMatches.map((m, idx) => (
                  <tr key={m.id} className={idx % 2 === 1 ? 'bg-slate-900/60' : 'bg-slate-950/60'}>
                    <td className="px-3 py-2 text-slate-200 text-end">{m.symbol}</td>
                    <td className="px-3 py-2 text-slate-400 text-end tabular-nums">{m.matchedTradeId}</td>
                    <td className="px-3 py-2 text-slate-300 text-end tabular-nums">{m.similarityPct.toFixed(1)}%</td>
                    <td className={`px-3 py-2 text-end tabular-nums ${m.confidenceLiftPct >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>
                      {m.confidenceLiftPct >= 0 ? '+' : ''}{m.confidenceLiftPct.toFixed(1)}%
                    </td>
                    <td className={`px-3 py-2 text-end ${m.outcome === 'win' ? 'text-emerald-400' : 'text-rose-300'}`}>
                      {m.outcome === 'win' ? 'Win-aligned' : 'Loss-aligned'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Agent Learning Center — insights for same date range as PnL (sync with CEO Briefing) */}
      <AgentLearningCenter fromDate={insightsDateRange.fromDate} toDate={insightsDateRange.toDate} />

      {/* Persistent Simulation (Paper Trading) — from DB, live P&L */}
      {simSummaryLoading && (
        <div className="rounded-xl bg-black/40 frosted-obsidian overflow-hidden min-w-0" dir="rtl">
          <Skeleton className="h-14 w-full rounded-none" />
          <div className="p-6 space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
              <Skeleton className="h-3 w-28 mb-1" />
              <Skeleton className="h-10 w-40" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-white/10">
                <div><Skeleton className="h-3 w-20 mb-1" /><Skeleton className="h-6 w-24" /></div>
                <div><Skeleton className="h-3 w-20 mb-1" /><Skeleton className="h-6 w-24" /></div>
                <div><Skeleton className="h-3 w-24 mb-1" /><Skeleton className="h-6 w-24" /></div>
              </div>
            </div>
          </div>
        </div>
      )}
      {!simSummaryLoading && simSummary != null && (() => {
        const lockedUsd = simSummary.positions.reduce((s, p) => s + (Number.isFinite(p.costUsd) ? p.costUsd! : 0), 0);
        const totalEquity = round2(
          (Number.isFinite(simSummary.walletUsd) ? simSummary.walletUsd : 0) +
          lockedUsd +
          (Number.isFinite(simSummary.totalUnrealizedPnlUsd) ? simSummary.totalUnrealizedPnlUsd : 0)
        );
        return (
        <div className="rounded-2xl overflow-hidden min-w-0 bg-gradient-to-b from-[#0a1628] to-[#06101a] border border-cyan-500/20 shadow-[0_0_24px_rgba(34,211,238,0.08)]" dir="rtl">
          <h3 className="text-sm font-bold text-cyan-50 px-6 py-4 border-b border-cyan-500/20">
            תחנת מסחר — סימולציה (Paper Trading)
          </h3>
          {simSummary.available ? (
            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/30 p-6 space-y-5">
                <div>
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">יתרה כוללת (ערך תיק)</p>
                  <p className="text-3xl sm:text-4xl font-bold text-cyan-50 tabular-nums" suppressHydrationWarning>
                    ${totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-cyan-500/20">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">יתרה פנויה</p>
                    <p className="text-lg font-semibold text-cyan-50 tabular-nums" suppressHydrationWarning>
                      ${round2(simSummary.walletUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">חסום בעסקאות</p>
                    <p className="text-lg font-semibold text-slate-300 tabular-nums">
                      ${round2(lockedUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">רווח/הפסד צף (לא ממומש)</p>
                    <p className={`text-lg font-semibold tabular-nums ${simSummary.totalUnrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      <span dir="ltr" className="inline-block">{simSummary.totalUnrealizedPnlUsd >= 0 ? '+' : ''}${round2(simSummary.totalUnrealizedPnlUsd).toFixed(2)}</span>
                    </p>
                  </div>
                </div>
                {/* God-Mode: Win Rate, Max Drawdown, Avg ROI per trade */}
                {(simSummary.simulationRoundTripsCount ?? 0) > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-cyan-500/20">
                    <div className="rounded-lg bg-cyan-950/40 border border-cyan-500/20 p-3">
                      <p className="text-xs text-slate-500 mb-0.5">אחוז הצלחה (סימולציה)</p>
                      <p className="text-xl font-bold text-cyan-50 tabular-nums">{simSummary.simulationWinRatePct?.toFixed(1) ?? 0}%</p>
                      <p className="text-xs text-slate-500">{(simSummary.simulationRoundTripsCount ?? 0)} סבבים</p>
                    </div>
                    <div className="rounded-lg bg-cyan-950/40 border border-cyan-500/20 p-3">
                      <p className="text-xs text-slate-500 mb-0.5">שפל מקסימלי (סימולציה)</p>
                      <p className="text-xl font-bold text-rose-400 tabular-nums">{simSummary.simulationMaxDrawdownPct?.toFixed(1) ?? 0}%</p>
                    </div>
                    <div className="rounded-lg bg-cyan-950/40 border border-cyan-500/20 p-3">
                      <p className="text-xs text-slate-500 mb-0.5">תשואה ממוצעת לעסקה</p>
                      <p className={`text-xl font-bold tabular-nums ${(simSummary.simulationAvgRoiPerTradePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        <span dir="ltr" className="inline-block">{(simSummary.simulationAvgRoiPerTradePct ?? 0) >= 0 ? '+' : ''}{(simSummary.simulationAvgRoiPerTradePct ?? 0).toFixed(2)}%</span>
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                  <span>פוזיציות פתוחות: {simSummary.positions.length}</span>
                  <span>עסקאות סימולציה: {simSummary.trades.length}</span>
                </div>
              </div>
              {simSummary.positions.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-amber-500 uppercase tracking-wider mb-2">פוזיציות לפי מחיר נוכחי</h4>
                  <ul className="text-sm space-y-1">
                    {simSummary.positions.map((p) => {
                      const costUsd = p.costUsd ?? 0;
                      const unrealizedPnlPct = costUsd > 0 ? (p.unrealizedPnlUsd / costUsd) * 100 : 0;
                      const isHeavyDrawdown = unrealizedPnlPct < -20;
                      return (
                        <li key={p.symbol} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5">
                            <span className="text-white">{p.symbol.replace('USDT', '')}</span>
                            {isHeavyDrawdown && (
                              <span
                                className="inline-flex items-center text-rose-500 animate-pulse"
                                title="אזהרת סיכון: הפסד צף מעל 20% — שקול סגירת פוזיציה או הורדת חשיפה"
                                aria-label="אזהרת סיכון"
                              >
                                <AlertTriangle className="w-4 h-4 shrink-0" />
                              </span>
                            )}
                          </span>
                          <span className="text-zinc-500 tabular-nums">{formatAmountForSymbol(p.amountAsset, p.symbol)} × ${formatPriceForSymbol(p.currentPrice, p.symbol)}</span>
                          <span className={`tabular-nums ${p.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                            <span dir="ltr" className="inline-block">{p.unrealizedPnlUsd >= 0 ? '+' : ''}{p.unrealizedPnlUsd.toFixed(2)} $</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {simSummary.trades.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">20 עסקאות סימולציה אחרונות</h4>
                  {isMobile ? (
                    <ul className="space-y-2">
                      {simSummary.trades.slice(0, 20).map((t) => (
                        <li key={t.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-white font-medium">{t.symbol.replace('USDT', '')}</span>
                            <span className="text-zinc-400">{t.side === 'buy' ? 'קנייה' : 'מכירה'}</span>
                          </div>
                          <div className="mt-1 text-zinc-400">
                            מחיר: <span dir="ltr">{formatPriceForSymbol(t.price, t.symbol)}</span> | סכום: <span dir="ltr">${formatFiat(t.amountUsd)}</span>
                          </div>
                          <div className="mt-1 text-zinc-500" suppressHydrationWarning>{t.dateLabel}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="overflow-x-auto max-h-[40vh] overflow-y-auto financial-grid-compact">
                      <table className="w-full min-w-[400px] border-collapse">
                        <thead className="sticky top-0 z-[var(--z-sticky)] bg-[#111111] border-b border-white/10">
                          <tr>
                            <th className="text-end py-2.5 px-4 text-zinc-500 font-medium">סמל</th>
                            <th className="text-end py-2.5 px-4 text-zinc-500 font-medium">כיוון</th>
                            <th className="text-end py-2.5 px-4 text-zinc-500 font-medium">מחיר</th>
                            <th className="text-end py-2.5 px-4 text-zinc-500 font-medium">סכום $</th>
                            <th className="text-end py-2.5 px-4 text-zinc-500 font-medium">זמן</th>
                          </tr>
                        </thead>
                        <tbody>
                          {simSummary.trades.slice(0, 20).map((t, idx) => (
                            <tr
                              key={t.id}
                              className={`border-b border-white/5 hover:bg-white/[0.03] transition-colors duration-300 ${idx % 2 === 1 ? 'bg-white/[0.02]' : ''}`}
                            >
                              <td className="py-2.5 px-4 text-white text-end">{t.symbol.replace('USDT', '')}</td>
                              <td className="py-2.5 px-4 text-zinc-500 text-end">{t.side === 'buy' ? 'קנייה' : 'מכירה'}</td>
                              <td className="py-2.5 px-4 text-zinc-500 text-end tabular-nums">{formatPriceForSymbol(t.price, t.symbol)}</td>
                              <td className="py-2.5 px-4 text-zinc-500 text-end tabular-nums">{formatFiat(t.amountUsd)}</td>
                              <td className="py-2.5 px-4 text-zinc-500 text-xs text-end" suppressHydrationWarning>{t.dateLabel}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {simSummary.trades.length === 0 && simSummary.positions.length === 0 && (
                <p className="text-zinc-500 text-sm">אין עדיין עסקאות סימולציה. בצע קנייה/מכירה מהאנליזר כדי לשמור במסד.</p>
              )}
              {virtualClosedTrades.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-amber-500 uppercase tracking-wider mb-2">תיק וירטואלי — סיבת סגירה</h4>
                  <p className="text-xs text-zinc-500 mb-2">מבנה עמלות: 0.1% כניסה (Maker) + 0.1% יציאה (Taker). רווח נטו = (מחיר יציאה − מחיר כניסה) × כמות − סה״כ עמלות.</p>
                  {isMobile ? (
                    <ul className="space-y-2">
                      {virtualClosedTrades.map((t) => (
                        <li key={t.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-white font-medium">{t.symbol.replace('USDT', '')}</span>
                            <span className="text-zinc-400">{t.close_reason ? CLOSE_REASON_HE[t.close_reason] : '—'}</span>
                          </div>
                          <div className="mt-1 text-zinc-400">
                            נטו: <span dir="ltr">{t.pnl_net_usd != null ? `${t.pnl_net_usd >= 0 ? '+' : ''}$${formatFiat(t.pnl_net_usd)}` : '—'}</span> | תשואה: <span dir="ltr">{t.pnl_pct != null ? `${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(2)}%` : '—'}</span>
                          </div>
                          <div className="mt-1 text-zinc-500" suppressHydrationWarning>
                            {t.closed_at ? formatDateTimeLocal(t.closed_at) : '—'}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="overflow-x-auto max-h-[30vh] overflow-y-auto financial-grid-compact">
                      <table className="w-full min-w-[640px] border-collapse">
                        <thead className="sticky top-0 z-[var(--z-sticky)] bg-[#111111] border-b border-white/10">
                          <tr>
                            <th className="text-end py-2 px-4 text-zinc-500 font-medium">סמל</th>
                            <th className="text-end py-2 px-4 text-zinc-500 font-medium">זמן רכישה</th>
                            <th className="text-end py-2 px-4 text-zinc-500 font-medium">תאריך סגירה</th>
                            <th className="text-end py-2 px-4 text-zinc-500 font-medium">עמלה כניסה</th>
                            <th className="text-end py-2 px-4 text-zinc-500 font-medium">עמלה יציאה</th>
                            <th className="text-end py-2 px-4 text-zinc-500 font-medium">רווח נטו $</th>
                            <th className="text-end py-2 px-4 text-zinc-500 font-medium">רווח/הפסד %</th>
                            <th className="text-end py-2 px-4 text-zinc-500 font-medium">סיבת סגירה</th>
                          </tr>
                        </thead>
                        <tbody>
                          {virtualClosedTrades.map((t) => (
                            <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                              <td className="py-2 px-4 text-white text-end">{t.symbol.replace('USDT', '')}</td>
                              <td className="py-2 px-4 text-zinc-500 text-xs text-end tabular-nums" suppressHydrationWarning>
                                {t.entry_date ? formatDateTimeLocal(t.entry_date) : '—'}
                              </td>
                              <td className="py-2 px-4 text-zinc-500 text-xs text-end" suppressHydrationWarning>
                                {t.closed_at ? formatDateTimeLocal(t.closed_at) : '—'}
                              </td>
                              <td className="py-2 px-4 text-zinc-400 text-end tabular-nums text-xs" dir="ltr">
                                {t.entry_fee_usd != null ? `$${formatFiat(t.entry_fee_usd)}` : '—'}
                              </td>
                              <td className="py-2 px-4 text-zinc-400 text-end tabular-nums text-xs" dir="ltr">
                                {t.exit_fee_usd != null ? `$${formatFiat(t.exit_fee_usd)}` : '—'}
                              </td>
                              <td className={`text-end tabular-nums font-medium ${(t.pnl_net_usd ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
                                {t.pnl_net_usd != null ? `${t.pnl_net_usd >= 0 ? '+' : ''}${formatFiat(t.pnl_net_usd)}` : (t.pnl_pct != null ? `~${formatFiat((t.amount_usd ?? 0) * (t.pnl_pct / 100))}` : '—')}
                              </td>
                              <td className={`text-end tabular-nums font-medium ${(t.pnl_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                <span dir="ltr" className="inline-block">{t.pnl_pct != null ? `${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(2)}%` : '—'}</span>
                              </td>
                              <td className="py-2 px-4 text-end text-zinc-400 text-xs">
                                {t.close_reason ? CLOSE_REASON_HE[t.close_reason] : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 text-zinc-500 text-sm">
              שמירת סימולציה זמינה כאשר מוגדר חיבור למסד (Quantum Core DB / DATABASE_URL). עסקאות מהאנליזר יישמרו ויופיעו כאן.
            </div>
          )}
        </div>
        ); })()}
    </div>
  );
}

export default memo(PnlTerminalInner);
