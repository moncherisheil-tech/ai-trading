'use client';

import type { CSSProperties } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { getT } from '@/lib/i18n';

const t = getT('he');
const TABULAR_NUMS_TEXT = { fontVariantNumeric: 'tabular-nums' } as CSSProperties;

export type AccuracyTimeSeriesPoint = {
  date: string;
  avgErrorPct: number;
  accuracyPct: number;
  total: number;
};

type PerformanceTrendsChartsProps = {
  timeSeries: AccuracyTimeSeriesPoint[];
  totalBacktests: number;
  currentAccuracyPct: number;
  lastLearningCycleDate: string | null;
  totalStrategiesApproved: number;
};

export default function PerformanceTrendsCharts({
  timeSeries,
  totalBacktests,
  currentAccuracyPct,
  lastLearningCycleDate,
  totalStrategiesApproved,
}: PerformanceTrendsChartsProps) {
  const hasData = timeSeries.length > 0;

  return (
    <section className="space-y-4" dir="rtl">
      <h2 className="text-lg font-semibold text-slate-200">מגמות ביצוע</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          className="rounded-xl border border-white/10 p-4 bg-gradient-to-br from-slate-950/75 via-zinc-950/70 to-black/70 frosted-obsidian"
          style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0px, rgba(255,255,255,0.02) 1px, transparent 1px)' }}
        >
          <div className="text-xs text-slate-400 uppercase tracking-wide">סה&quot;כ בדיקות</div>
          <div className="text-2xl font-semibold text-slate-100 tabular-nums">{totalBacktests}</div>
        </div>
        <div
          className="rounded-xl border border-white/10 p-4 bg-gradient-to-br from-slate-950/75 via-zinc-950/70 to-black/70 frosted-obsidian"
          style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0px, rgba(255,255,255,0.02) 1px, transparent 1px)' }}
        >
          <div className="text-xs text-slate-400 uppercase tracking-wide">דיוק נוכחי</div>
          <div className="text-2xl font-semibold text-emerald-400 tabular-nums">
            {totalBacktests > 0 ? `${currentAccuracyPct}%` : '—'}
          </div>
        </div>
        <div
          className="rounded-xl border border-white/10 p-4 bg-gradient-to-br from-slate-950/75 via-zinc-950/70 to-black/70 frosted-obsidian"
          style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0px, rgba(255,255,255,0.02) 1px, transparent 1px)' }}
        >
          <div className="text-xs text-slate-400 uppercase tracking-wide">מחזור למידה אחרון</div>
          <div className="text-sm font-medium text-slate-300 tabular-nums">
            {lastLearningCycleDate
              ? new Date(lastLearningCycleDate).toLocaleDateString('he-IL', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : '—'}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {totalStrategiesApproved} תובנות מאושרות
          </div>
        </div>
      </div>

      {!hasData ? (
        <div
          className="rounded-xl border border-white/10 p-6 text-center text-slate-400 text-sm bg-gradient-to-br from-slate-950/75 via-zinc-950/70 to-black/70 frosted-obsidian"
          style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0px, rgba(255,255,255,0.02) 1px, transparent 1px)' }}
        >
          אין עדיין נתוני בדיקה. הערך תחזיות כדי לראות מגמות דיוק.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div
            className="rounded-xl border border-white/10 p-4 bg-gradient-to-br from-slate-950/75 via-zinc-950/70 to-black/70 frosted-obsidian"
            style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0px, rgba(255,255,255,0.02) 1px, transparent 1px)' }}
          >
            <h3 className="text-sm font-medium text-slate-300 mb-3">
              שיעור שגיאה ממוצע לאורך זמן
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    className="tabular-nums"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <YAxis
                    orientation="right"
                    domain={[0, 'auto']}
                    className="tabular-nums"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(val) => `${val}%`}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid rgb(51 65 85)',
                      backgroundColor: 'rgb(2 6 23 / 0.96)',
                      boxShadow: '0 10px 30px -12px rgb(0 0 0 / 0.7)',
                      color: 'rgb(241 245 249)',
                      textAlign: 'right',
                      direction: 'rtl',
                      ...TABULAR_NUMS_TEXT,
                      zIndex: 9999,
                    } as CSSProperties}
                    formatter={(value) => [`${Number(value ?? 0)}%`, 'Avg Error']}
                    labelFormatter={(label) => `Date: ${label}`}
                    labelStyle={{ color: 'rgb(203 213 225)', ...TABULAR_NUMS_TEXT } as CSSProperties}
                    itemStyle={{ ...TABULAR_NUMS_TEXT } as CSSProperties}
                    wrapperStyle={{ direction: 'rtl', zIndex: 9999, maxWidth: '260px' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgErrorPct"
                    name="Avg Error %"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#dc2626' }}
                    activeDot={{ r: 4, fill: '#dc2626', stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div
            className="rounded-xl border border-white/10 p-4 bg-gradient-to-br from-slate-950/75 via-zinc-950/70 to-black/70 frosted-obsidian"
            style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.09) 0px, rgba(255,255,255,0.02) 1px, transparent 1px)' }}
          >
            <h3 className="text-sm font-medium text-slate-300 mb-3">
              {t.accuracyChartTitle}
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    className="tabular-nums"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <YAxis
                    orientation="right"
                    domain={[0, 100]}
                    className="tabular-nums"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(val) => `${val}%`}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid rgb(51 65 85)',
                      backgroundColor: 'rgb(2 6 23 / 0.96)',
                      boxShadow: '0 10px 30px -12px rgb(0 0 0 / 0.7)',
                      color: 'rgb(241 245 249)',
                      textAlign: 'right',
                      direction: 'rtl',
                      ...TABULAR_NUMS_TEXT,
                      zIndex: 9999,
                    } as CSSProperties}
                    formatter={(value) => [`${Number(value ?? 0)}%`, t.accuracyLabel]}
                    labelFormatter={(label) => `${t.dateLabel}: ${label}`}
                    labelStyle={{ color: 'rgb(203 213 225)', ...TABULAR_NUMS_TEXT } as CSSProperties}
                    itemStyle={{ ...TABULAR_NUMS_TEXT } as CSSProperties}
                    wrapperStyle={{ direction: 'rtl', zIndex: 9999, maxWidth: '260px' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="accuracyPct"
                    name={`${t.accuracyLabel} %`}
                    stroke="#059669"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#059669' }}
                    activeDot={{ r: 4, fill: '#059669', stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
