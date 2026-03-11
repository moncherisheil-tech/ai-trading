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
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">Performance Trends</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Total Backtests</div>
          <div className="text-2xl font-semibold text-slate-900">{totalBacktests}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Current Accuracy</div>
          <div className="text-2xl font-semibold text-emerald-600">
            {totalBacktests > 0 ? `${currentAccuracyPct}%` : '—'}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Last Learning Cycle</div>
          <div className="text-sm font-medium text-slate-700">
            {lastLearningCycleDate
              ? new Date(lastLearningCycleDate).toLocaleDateString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : '—'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {totalStrategiesApproved} strategy insights approved
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-500 text-sm">
          No backtest data yet. Evaluate some predictions to see precision trends.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-medium text-slate-700 mb-3">
              Average Error Rate Over Time (goal: trending down)
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
                    }}
                    formatter={(value: number) => [`${value}%`, 'Avg Error']}
                    labelFormatter={(label) => `Date: ${label}`}
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

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-medium text-slate-700 mb-3">
              Prediction Accuracy % (goal: trending up)
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
                    }}
                    formatter={(value: number) => [`${value}%`, 'Accuracy']}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="accuracyPct"
                    name="Accuracy %"
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
