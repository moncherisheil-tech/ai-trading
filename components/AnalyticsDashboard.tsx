'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
} from 'recharts';
import {
  Calendar,
  TrendingUp,
  TrendingDown,
  Percent,
  Target,
  BarChart3,
  DollarSign,
  Clock,
  FileText,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import SystemOptimizationCard from '@/components/SystemOptimizationCard';

const PRESETS = [
  { id: 'today', label: 'היום', getRange: () => {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
    const end = new Date(d);
    return { from: start.toISOString(), to: end.toISOString() };
  }},
  { id: 'week', label: 'השבוע', getRange: () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(d.setDate(diff));
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    return { from: start.toISOString(), to: end.toISOString() };
  }},
  { id: 'month', label: 'החודש', getRange: () => {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0);
    const end = new Date();
    return { from: start.toISOString(), to: end.toISOString() };
  }},
  { id: 'all', label: 'כל הזמן', getRange: () => {
    const start = new Date(2020, 0, 1, 0, 0, 0);
    const end = new Date();
    return { from: start.toISOString(), to: end.toISOString() };
  }},
] as const;

function formatDateForInput(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

export type HistoricalMetrics = {
  success: boolean;
  from_date: string;
  to_date: string;
  total_net_pnl_usd: number;
  total_net_pnl_pct: number;
  win_rate_pct: number;
  profit_factor: number;
  sharpe_ratio: number;
  max_drawdown_usd: number;
  max_drawdown_pct: number;
  total_fees_usd: number;
  avg_trade_duration_hours: number | null;
  equity_curve: { date: string; balance: number; cumulative_pnl: number }[];
  daily_pnl: { date: string; pnl: number }[];
  total_trades: number;
  backtest_trades: number;
  virtual_trades: number;
};

export type CeoBriefing = {
  success: boolean;
  summary_he: string;
  insights_count: number;
  from_date?: string;
  to_date?: string;
};

export default function AnalyticsDashboard() {
  const now = new Date();
  const defaultEnd = new Date(now);
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 30);

  const [fromDate, setFromDate] = useState(() => formatDateForInput(defaultStart.toISOString()));
  const [toDate, setToDate] = useState(() => formatDateForInput(defaultEnd.toISOString()));
  const [metrics, setMetrics] = useState<HistoricalMetrics | null>(null);
  const [briefing, setBriefing] = useState<CeoBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

  const fromIso = `${fromDate}T00:00:00.000Z`;
  const toIso = `${toDate}T23:59:59.999Z`;

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/ops/metrics/historical?from_date=${encodeURIComponent(fromIso)}&to_date=${encodeURIComponent(toIso)}`,
        { credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'שגיאה בטעינת נתונים');
        setMetrics(null);
        return;
      }
      setMetrics(data as HistoricalMetrics);
    } catch (e) {
      setError('שגיאה בחיבור לשרת');
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, [fromIso, toIso]);

  const fetchBriefing = useCallback(async () => {
    if (!metrics) return;
    setBriefingLoading(true);
    try {
      const params = new URLSearchParams({
        from_date: fromIso,
        to_date: toIso,
        total_pnl_pct: String(metrics.total_net_pnl_pct),
        win_rate_pct: String(metrics.win_rate_pct),
      });
      const res = await fetch(`/api/ops/analytics/ceo-briefing?${params}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data?.success) setBriefing(data as CeoBriefing);
      else setBriefing(null);
    } catch {
      setBriefing(null);
    } finally {
      setBriefingLoading(false);
    }
  }, [fromIso, toIso, metrics]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    if (metrics?.success) fetchBriefing();
    else setBriefing(null);
  }, [metrics?.success, fetchBriefing]);

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    const { from, to } = preset.getRange();
    setFromDate(formatDateForInput(from));
    setToDate(formatDateForInput(to));
  };

  return (
    <div className="space-y-6 min-w-0 w-full max-w-full overflow-x-hidden" dir="rtl">
      {/* טווח תאריכים */}
      <section className="rounded-2xl border border-[var(--app-border,rgba(255,255,255,0.08))] bg-[var(--app-surface,#111111)] p-4 sm:p-5 min-w-0">
        <h2 className="text-sm font-semibold text-[var(--app-muted,rgb(113,113,122))] uppercase tracking-wider mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[var(--app-accent,rgb(34,197,94))]" />
          טווח תאריכים
        </h2>
        <div className="flex flex-wrap items-end gap-3 sm:gap-4 min-w-0">
          <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-initial sm:min-w-[140px]">
            <label className="text-xs text-[var(--app-muted)]">מתאריך</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-xl border border-[var(--app-border)] bg-[var(--app-bg,#050505)] text-[var(--app-text)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--app-accent)]/50 focus:border-[var(--app-accent)]/30 min-h-[44px] w-full max-w-full"
            />
          </div>
          <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-initial sm:min-w-[140px]">
            <label className="text-xs text-[var(--app-muted)]">עד תאריך</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-text)] px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--app-accent)]/50 min-h-[44px] w-full max-w-full"
            />
          </div>
          <button
            type="button"
            onClick={() => fetchMetrics()}
            className="rounded-xl bg-[var(--app-accent)]/20 border border-[var(--app-accent)]/30 text-[var(--app-accent)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--app-accent)]/30 transition-colors min-h-[44px]"
          >
            עדכן נתונים
          </button>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-muted)] px-3 py-2 text-xs font-medium hover:bg-white/5 hover:text-[var(--app-text)] transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-[var(--app-muted)]">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>טוען ביצועי תקופה...</span>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-[var(--app-danger,rgb(239,68,68))]/30 bg-[var(--app-danger)]/10 p-4 flex items-center gap-2 text-[var(--app-danger)]">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && metrics?.success && (
        <>
          {/* ביצועי תקופה — Metrics Grid: stable layout on small screens to prevent shift */}
          <section className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--app-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
              ביצועי תקופה
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 sm:gap-4 min-w-0 [&>div]:min-w-0">
              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 transition-all hover:bg-white/[0.02] min-w-0 overflow-hidden">
                <div className="flex items-center gap-1.5 mb-1 min-w-0">
                  <DollarSign className="w-4 h-4 text-[var(--app-muted)] shrink-0" />
                  <span className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider truncate">רווח נטו ($)</span>
                </div>
                <div className={`text-lg sm:text-xl font-bold truncate ${metrics.total_net_pnl_usd >= 0 ? 'text-emerald-400' : 'text-[var(--app-danger)]'}`}>
                  {metrics.total_net_pnl_usd >= 0 ? '+' : ''}{metrics.total_net_pnl_usd.toFixed(2)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 transition-all hover:bg-white/[0.02]">
                <div className="flex items-center gap-1.5 mb-1">
                  <Percent className="w-4 h-4 text-[var(--app-muted)]" />
                  <span className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">רווח נטו (%)</span>
                </div>
                <div className={`text-lg sm:text-xl font-bold ${metrics.total_net_pnl_pct >= 0 ? 'text-emerald-400' : 'text-[var(--app-danger)]'}`}>
                  {metrics.total_net_pnl_pct >= 0 ? '+' : ''}{metrics.total_net_pnl_pct.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 transition-all hover:bg-white/[0.02]">
                <div className="flex items-center gap-1.5 mb-1">
                  <Target className="w-4 h-4 text-[var(--app-muted)]" />
                  <span className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">אחוז הצלחה</span>
                </div>
                <div className="text-lg sm:text-xl font-bold text-[var(--app-text)]">
                  {metrics.win_rate_pct.toFixed(1)}%
                </div>
              </div>
              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 transition-all hover:bg-white/[0.02]">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="w-4 h-4 text-[var(--app-muted)]" />
                  <span className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">מקדם רווח</span>
                </div>
                <div className="text-lg sm:text-xl font-bold text-[var(--app-text)]">
                  {metrics.total_trades ? metrics.profit_factor.toFixed(2) : 'N/A'}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 transition-all hover:bg-white/[0.02]">
                <div className="flex items-center gap-1.5 mb-1">
                  <BarChart3 className="w-4 h-4 text-[var(--app-muted)]" />
                  <span className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">מדד יציבות (שרפ)</span>
                </div>
                <div className="text-lg sm:text-xl font-bold text-[var(--app-text)]">
                  {metrics.total_trades ? metrics.sharpe_ratio.toFixed(2) : 'N/A'}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 transition-all hover:bg-white/[0.02]">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingDown className="w-4 h-4 text-[var(--app-danger)]" />
                  <span className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">משיכה מקסימלית</span>
                </div>
                <div className="text-lg sm:text-xl font-bold text-[var(--app-danger)]">
                  ${metrics.max_drawdown_usd.toFixed(2)} ({metrics.max_drawdown_pct.toFixed(1)}%)
                </div>
              </div>
              <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 transition-all hover:bg-white/[0.02]">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="w-4 h-4 text-[var(--app-muted)]" />
                  <span className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">עמלות</span>
                </div>
                <div className="text-lg sm:text-xl font-bold text-[var(--app-text)]">
                  ${metrics.total_fees_usd.toFixed(2)}
                </div>
                {metrics.avg_trade_duration_hours != null && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-[var(--app-muted)]">
                    <Clock className="w-3 h-3" />
                    ממוצע משך: {metrics.avg_trade_duration_hours.toFixed(0)} שעות
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs text-[var(--app-muted)] mt-2">
              סה״כ {metrics.total_trades} עסקאות בתקופה (בקטסט: {metrics.backtest_trades}, תיק וירטואלי: {metrics.virtual_trades})
            </p>
          </section>

          {/* ניתוח מגמות — Cumulative PnL Chart */}
          <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 sm:p-5 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--app-muted)] uppercase tracking-wider mb-4 flex items-center gap-2 min-w-0">
              <TrendingUp className="w-4 h-4 text-[var(--app-accent)] shrink-0" />
              <span className="truncate">ניתוח מגמות — עקומת רווח מצטבר</span>
            </h2>
            <div className="h-64 sm:h-72 min-h-[200px] w-full min-w-0 overflow-hidden">
              {metrics.equity_curve?.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={metrics.equity_curve}
                    margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                  >
                    <defs>
                      <linearGradient id="analyticsEquityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--app-accent)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--app-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--app-border)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'var(--app-muted)' }}
                      stroke="var(--app-border)"
                    />
                    <YAxis
                      orientation="right"
                      tick={{ fontSize: 10, fill: 'var(--app-muted)' }}
                      stroke="var(--app-border)"
                      tickFormatter={(v) => `$${v.toLocaleString()}`}
                      width={70}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--app-surface)',
                        border: '1px solid var(--app-border)',
                        borderRadius: '8px',
                        textAlign: 'right',
                        direction: 'rtl',
                        zIndex: 9999,
                      }}
                      formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}`, 'יתרה']}
                      labelFormatter={(l) => `תאריך: ${l}`}
                      wrapperStyle={{ direction: 'rtl', zIndex: 9999 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke="var(--app-accent)"
                      strokeWidth={2}
                      fill="url(#analyticsEquityGradient)"
                      name="יתרה"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--app-muted)] text-sm">
                  אין נתוני עקומה בתקופה הנבחרת.
                </div>
              )}
            </div>
          </section>

          {/* תובנות אסטרטגיות — CEO Briefing */}
          <section className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-[var(--app-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-[var(--app-accent)]" />
              תובנות אסטרטגיות — סיכום תקופתי (CEO Briefing)
            </h2>
            {briefingLoading ? (
              <div className="flex items-center gap-2 py-4 text-[var(--app-muted)]">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>מכין סיכום...</span>
              </div>
            ) : briefing?.summary_he ? (
              <>
                <p className="text-xs text-[var(--app-muted)] mb-2">
                  טווח מסונכרן עם ביצועי התקופה: {fromDate} – {toDate}. תובנות סוכן (מרכז למידה) באותו טווח: {briefing.insights_count}.
                </p>
                <p
                  className="text-[var(--app-text)] text-sm leading-relaxed whitespace-pre-wrap"
                  dir="rtl"
                >
                  {briefing.summary_he}
                </p>
              </>
            ) : (
              <p className="text-[var(--app-muted)] text-sm">
                לא זמין סיכום לתקופה זו. ודא שיש תובנות סוכן בטווח התאריכים.
              </p>
            )}
          </section>

          {/* אופטימיזציית מערכת — כיול אוטונומי */}
          <SystemOptimizationCard />
        </>
      )}
    </div>
  );
}
