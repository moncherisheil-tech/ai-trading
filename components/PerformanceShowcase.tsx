'use client';

import { useState, useRef, useMemo, useCallback, useEffect, memo } from 'react';
import Link from 'next/link';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { ArrowLeft, FileText, TrendingUp, Target, BarChart3, Loader2, AlertCircle, RefreshCw, Brain } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToastOptional } from '@/context/ToastContext';
import PortfolioAllocation from '@/components/PortfolioAllocation';
import { getLearningAccuracyAction, getOpsMetricsHistoricalAction, getSimulationSummaryAction } from '@/app/actions';

export type HistoricalMetricsPayload = {
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
  annualized_return_pct?: number;
  calmar_ratio?: number;
  total_fees_usd: number;
  avg_trade_duration_hours: number | null;
  equity_curve: { date: string; balance: number; cumulative_pnl: number }[];
  daily_pnl: { date: string; pnl: number }[];
  total_trades: number;
  backtest_trades: number;
  virtual_trades: number;
};


const HEBREW_MONTHS: Record<string, string> = {
  '01': 'ינואר', '02': 'פברואר', '03': 'מרץ', '04': 'אפריל', '05': 'מאי', '06': 'יוני',
  '07': 'יולי', '08': 'אוגוסט', '09': 'ספטמבר', '10': 'אוקטובר', '11': 'נובמבר', '12': 'דצמבר',
};

type PerformanceShowcaseProps = {
  initialData: HistoricalMetricsPayload | null;
};

/** Aggregate equity curve by month for display: first balance of month, last balance, return %. */
function useMonthlyBreakdown(equityCurve: { date: string; balance: number }[]) {
  return useMemo(() => {
    if (!equityCurve?.length) return [];
    const byMonth = new Map<string, { first: number; last: number }>();
    for (const p of equityCurve) {
      const key = p.date.slice(0, 7); // YYYY-MM
      const current = byMonth.get(key);
      if (!current) {
        byMonth.set(key, { first: p.balance, last: p.balance });
      } else {
        byMonth.set(key, { first: current.first, last: p.balance });
      }
    }
    return Array.from(byMonth.entries())
      .map(([ym, { first, last }]) => {
        const [y, m] = ym.split('-');
        const label = `${HEBREW_MONTHS[m] ?? m} ${y}`;
        const pct = first > 0 ? ((last - first) / first) * 100 : 0;
        return { monthKey: ym, label, pct, first, last };
      })
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .reverse();
  }, [equityCurve]);
}

type SimSummary = {
  available: boolean;
  walletUsd: number;
  positions: Array<{ symbol: string; amountAsset: number; costUsd: number; currentPrice: number; unrealizedPnlUsd: number }>;
};

export type LearningAccuracyPoint = {
  date: string;
  win_rate: number;
  prediction_accuracy_score: number;
  learning_delta: number;
};

function PerformanceShowcaseInner({ initialData }: PerformanceShowcaseProps) {
  const toast = useToastOptional();
  const [data, setData] = useState<HistoricalMetricsPayload | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [simSummary, setSimSummary] = useState<SimSummary | null>(null);
  const [learningAccuracy, setLearningAccuracy] = useState<LearningAccuracyPoint[] | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const equityCurve = data?.equity_curve ?? [];
  const monthlyBreakdown = useMonthlyBreakdown(equityCurve);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const start = new Date(2020, 0, 1).toISOString();
      const end = new Date().toISOString();
      const out = await getOpsMetricsHistoricalAction({ from_date: start, to_date: end });
      if (out.success) setData(out.data as HistoricalMetricsPayload);
      else setData(null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialData !== undefined && initialData !== null && data === null && !loading) {
      setData(initialData);
    }
  }, [initialData, data, loading]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const out = await getSimulationSummaryAction();
        if (!cancelled && out.success) setSimSummary(out.data as SimSummary);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 90);
    const from = start.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);
    void (async () => {
      try {
        const out = await getLearningAccuracyAction({ from_date: from, to_date: to });
        if (!cancelled && out.success) {
          const payload = out.data as { data?: LearningAccuracyPoint[] };
          if (Array.isArray(payload?.data)) setLearningAccuracy(payload.data);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalGrowthPct = data?.total_net_pnl_pct ?? 0;
  const winRatePct = data?.win_rate_pct ?? 0;
  const profitFactor = data?.profit_factor ?? 0;
  const sharpeRatio = data?.sharpe_ratio ?? 0;
  const maxDrawdownPct = data?.max_drawdown_pct ?? 0;
  const maxDrawdownUsd = data?.max_drawdown_usd ?? 0;
  const calmarRatio = data?.calmar_ratio ?? 0;
  const annualizedReturnPct = data?.annualized_return_pct ?? 0;

  const exportExecutivePdf = () => {
    if (pdfExporting) return;
    setPdfExporting(true);
    try {
      window.print();
      toast?.success('דוח ביצועים הופנה להדפסה — בחר "שמירה כ-PDF" להצלת קובץ');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ייצוא נכשל';
      console.error('[PerformanceShowcase] Print error:', err);
      toast?.error(`הדפסה: ${msg}`);
    } finally {
      setPdfExporting(false);
    }
  };

  const hasData = data?.success && (equityCurve.length > 0 || data.total_trades > 0);
  const isInitialLoad = data === null && !loading;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6 min-w-0" dir="rtl">
      {/* Top bar: back link, title, PDF button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/ops"
            className="flex items-center gap-2 text-sm font-medium text-[var(--app-muted)] hover:text-[var(--app-accent)] transition-all duration-300 ease-in-out hover:scale-[1.02] active:scale-95"
            prefetch
          >
            <ArrowLeft className="w-4 h-4 shrink-0 rtl:rotate-180" aria-hidden />
            חזרה ללוח פעולות
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--app-text)]">
            תצוגת ביצועים — Proof of Performance
          </h1>
        </div>
        <button
          type="button"
          onClick={exportExecutivePdf}
          disabled={pdfExporting || !hasData}
          aria-label={pdfExporting ? 'מייצא דוח PDF' : 'ייצוא דוח ביצועים (PDF)'}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--app-accent)]/20 border border-[var(--app-accent)]/40 text-[var(--app-accent)] hover:bg-[var(--app-accent)]/30 hover:scale-[1.02] active:scale-95 px-4 py-2.5 text-sm font-semibold transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          <FileText className="w-4 h-4 shrink-0" aria-hidden />
          {pdfExporting ? 'מייצא…' : 'ייצוא דו"ח ביצועים (PDF)'}
        </button>
      </div>

      {/* Refresh */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 frosted-obsidian text-[var(--app-muted)] hover:text-[var(--app-text)] hover:scale-[1.02] active:scale-95 px-3 py-2 text-sm transition-all duration-300 ease-in-out disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          {loading ? 'מרענן…' : 'רענון נתונים'}
        </button>
      </div>

      {loading && !data && (
        <div className="space-y-6" dir="rtl">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-black/40 frosted-obsidian p-6">
                <Skeleton className="h-3 w-24 mb-2 animate-pulse" />
                <Skeleton className="h-8 w-20 animate-pulse" />
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/40 frosted-obsidian p-6">
            <Skeleton className="h-4 w-40 mb-4 animate-pulse" />
            <Skeleton className="h-72 w-full rounded-xl animate-pulse" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-3">
                <Skeleton className="h-3 w-20 mb-2 animate-pulse" />
                <Skeleton className="h-6 w-16 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !hasData && data !== null && (
        <div className="rounded-2xl border border-[var(--app-danger)]/30 bg-[var(--app-danger)]/10 p-6 flex items-center gap-3 text-[var(--app-danger)]">
          <AlertCircle className="w-6 h-6 shrink-0" aria-hidden />
          <span>לא נמצאו נתוני ביצועים לתקופה. הרץ הערכות וסגור עסקאות וירטואליות כדי לראות נתונים.</span>
        </div>
      )}

      {hasData && (
        <>
          {/* Content captured for Executive PDF (summary + chart + monthly) */}
          <div ref={reportRef} className="print-mode space-y-6">
          {/* Executive Summary card */}
          <section
            className="rounded-xl border border-white/10 bg-black/40 frosted-obsidian p-6 sm:p-8 shadow-lg overflow-hidden"
            aria-label="סיכום ביצועי מערכת"
          >
            <h2 className="text-sm font-semibold text-[var(--app-muted)] uppercase tracking-wider mb-5 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[var(--app-accent)]" aria-hidden />
              סיכום ביצועי מערכת
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">תשואה מצטברת</p>
                <p
                  className={`text-2xl sm:text-3xl font-bold ${
                    totalGrowthPct >= 0 ? 'text-[var(--app-accent)]' : 'text-[var(--app-danger)]'
                  }`}
                >
                  {totalGrowthPct >= 0 ? '+' : ''}{totalGrowthPct.toFixed(2)}%
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">אחוז הצלחה</p>
                <p className="text-2xl sm:text-3xl font-bold text-[var(--app-text)]">{winRatePct.toFixed(1)}%</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">מקדם רווח</p>
                <p className="text-2xl sm:text-3xl font-bold text-[var(--app-text)]">{data?.total_trades ? profitFactor.toFixed(2) : 'N/A'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">מדד יציבות (שרפ)</p>
                <p className="text-2xl sm:text-3xl font-bold text-[var(--app-text)]">{data?.total_trades ? sharpeRatio.toFixed(2) : 'N/A'}</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--app-border)] flex flex-wrap gap-4 text-sm">
              <span className="text-[var(--app-muted)]">
                משיכה מקסימלית (MDD): <span className="text-[var(--app-danger)] font-medium">${maxDrawdownUsd.toFixed(2)} ({maxDrawdownPct.toFixed(1)}%)</span>
              </span>
              <span className="text-[var(--app-muted)]">
                יחס קלמר: <span className="text-[var(--app-text)] font-medium">{Number.isFinite(calmarRatio) ? calmarRatio.toFixed(2) : 'N/A'}</span>
              </span>
              <span className="text-[var(--app-muted)]">
                תשואה שנתית: <span className="text-[var(--app-accent)] font-medium">{Number.isFinite(annualizedReturnPct) ? `${annualizedReturnPct >= 0 ? '+' : ''}${annualizedReturnPct.toFixed(2)}%` : 'N/A'}</span>
              </span>
              <span className="text-[var(--app-muted)]">
                סה״כ עסקאות: <span className="text-[var(--app-text)] font-medium">{data.total_trades}</span>
              </span>
            </div>
          </section>

          {/* Portfolio Allocation & Exposure — from simulation summary when available */}
          <PortfolioAllocation
            simulationSummary={
              simSummary?.available && (simSummary.walletUsd > 0 || (simSummary.positions?.length ?? 0) > 0)
                ? { walletUsd: simSummary.walletUsd, positions: simSummary.positions ?? [] }
                : null
            }
          />

          {/* Main Equity Curve — Glassmorphism style */}
          <section className="rounded-xl border border-white/10 bg-black/40 frosted-obsidian shadow-xl p-6 sm:p-8 overflow-hidden">
            <h2 className="text-sm font-semibold text-[var(--app-muted)] uppercase tracking-wider mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[var(--app-accent)]" aria-hidden />
              עקומת הון מצטברת
            </h2>
            <div className="h-72 sm:h-80 min-h-[240px] w-full min-w-0 rounded-xl bg-black/20 border border-white/5 p-2">
              {equityCurve.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityCurve} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <defs>
                      <linearGradient id="performanceEquityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--app-accent)" stopOpacity={0.45} />
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
                      width={72}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--app-surface)',
                        border: '1px solid var(--app-border)',
                        borderRadius: '12px',
                        textAlign: 'right',
                        direction: 'rtl',
                        zIndex: 9999,
                      }}
                      formatter={(value) => [`$${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'יתרה']}
                      labelFormatter={(label) => `תאריך: ${label}`}
                      wrapperStyle={{ zIndex: 9999 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="balance"
                      stroke="var(--app-accent)"
                      strokeWidth={2}
                      fill="url(#performanceEquityGradient)"
                      name="יתרה"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--app-muted)] text-sm">
                  אין עדיין נתוני עקומת הון.
                </div>
              )}
            </div>
          </section>

          {/* Learning Progress — accuracy trend (v1.4) */}
          <section className="rounded-xl border border-white/10 bg-black/40 frosted-obsidian p-6 sm:p-8 overflow-hidden">
            <h2 className="text-sm font-semibold text-[var(--app-muted)] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Brain className="w-4 h-4 text-[var(--app-accent)]" aria-hidden />
              התקדמות למידה
            </h2>
            <div className="h-48 min-h-[160px] w-full min-w-0 rounded-xl bg-black/20 border border-white/5 p-2">
              {learningAccuracy && learningAccuracy.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={learningAccuracy} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
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
                      tickFormatter={(v) => `${v}%`}
                      domain={[0, 100]}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--app-surface)',
                        border: '1px solid var(--app-border)',
                        borderRadius: '12px',
                        textAlign: 'right',
                        direction: 'rtl',
                        zIndex: 9999,
                      }}
                      wrapperStyle={{ zIndex: 9999 }}
                      content={(props) => {
                        if (!props.active || !props.payload?.length) return null;
                        const p = props.payload[0]?.payload as LearningAccuracyPoint;
                        return (
                          <div
                            className="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2 text-sm shadow-lg"
                            style={{ direction: 'rtl', textAlign: 'right' }}
                          >
                            <p className="text-[var(--app-muted)] mb-1">רמת דיוק משופרת על סמך סינון תבניות עבר</p>
                            <p className="font-medium text-[var(--app-text)]">דיוק: {p?.prediction_accuracy_score?.toFixed(1) ?? 0}%</p>
                            <p className="text-xs text-[var(--app-muted)]">אחוז הצלחה: {p?.win_rate?.toFixed(1) ?? 0}%</p>
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="prediction_accuracy_score"
                      stroke="var(--app-accent)"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      name="דיוק תחזית"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--app-muted)] text-sm" title="רמת דיוק משופרת על סמך סינון תבניות עבר">
                  אין עדיין נתוני דיוק למידה. הסיכום היומי יבנה את הנתונים.
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-[var(--app-muted)]" title="רמת דיוק משופרת על סמך סינון תבניות עבר">
              רמת דיוק משופרת על סמך סינון תבניות עבר
            </p>
          </section>

          {/* Monthly breakdown */}
          <section className="rounded-xl border border-white/10 bg-black/40 frosted-obsidian p-6 sm:p-8 overflow-hidden">
            <h2 className="text-sm font-semibold text-[var(--app-muted)] uppercase tracking-wider mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-[var(--app-accent)]" aria-hidden />
              פירוט חודשי
            </h2>
            {monthlyBreakdown.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {monthlyBreakdown.map((row) => (
                  <div
                    key={row.monthKey}
                    className="rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-center"
                  >
                    <p className="text-xs text-[var(--app-muted)] mb-1">{row.label}</p>
                    <p
                      className={`text-lg font-bold ${
                        row.pct >= 0 ? 'text-[var(--app-accent)]' : 'text-[var(--app-danger)]'
                      }`}
                    >
                      {row.pct >= 0 ? '+' : ''}{row.pct.toFixed(1)}%
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--app-muted)]">אין עדיין נתונים חודשיים.</p>
            )}
          </section>
          </div>
        </>
      )}

      {isInitialLoad && !loading && (
        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center text-[var(--app-muted)]">
          <p>טוען נתוני ביצועים…</p>
        </div>
      )}
    </div>
  );
}

export default memo(PerformanceShowcaseInner);
