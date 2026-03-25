'use client';

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
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="text-xs text-slate-400 uppercase tracking-wide">סה&quot;כ בדיקות</div>
          <div className="text-2xl font-semibold text-slate-100">{totalBacktests}</div>
        </div>
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="text-xs text-slate-400 uppercase tracking-wide">דיוק נוכחי</div>
          <div className="text-2xl font-semibold text-emerald-400">
            {totalBacktests > 0 ? `${currentAccuracyPct}%` : '—'}
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
          <div className="text-xs text-slate-400 uppercase tracking-wide">מחזור למידה אחרון</div>
          <div className="text-sm font-medium text-slate-300">
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
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 text-center text-slate-400 text-sm">
          אין עדיין נתוני בדיקה. הערך תחזיות כדי לראות מגמות דיוק.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-sm font-medium text-slate-300 mb-3">
              שיעור שגיאה ממוצע לאורך זמן
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <YAxis
                    orientation="right"
                    domain={[0, 'auto']}
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(val) => `${val}%`}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      textAlign: 'right',
                      direction: 'rtl',
                      zIndex: 9999,
                    }}
                    formatter={(value) => [`${Number(value ?? 0)}%`, 'Avg Error']}
                    labelFormatter={(label) => `Date: ${label}`}
                    wrapperStyle={{ direction: 'rtl', zIndex: 9999 }}
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

          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <h3 className="text-sm font-medium text-slate-300 mb-3">
              {t.accuracyChartTitle}
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={20}
                  />
                  <YAxis
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(val) => `${val}%`}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      textAlign: 'right',
                      direction: 'rtl',
                      zIndex: 9999,
                    }}
                    formatter={(value) => [`${Number(value ?? 0)}%`, t.accuracyLabel]}
                    labelFormatter={(label) => `${t.dateLabel}: ${label}`}
                    wrapperStyle={{ direction: 'rtl', zIndex: 9999 }}
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
