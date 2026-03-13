'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export type AccuracyBucket = {
  bucket: string;
  confidence_min: number;
  confidence_max: number;
  total: number;
  hits: number;
  success_rate_pct: number;
};

type Props = { data: AccuracyBucket[] };

const BAR_COLOR = 'rgb(52, 211, 153)'; // emerald-400
const BAR_COLOR_LOW = 'rgb(100, 116, 139)'; // slate-400

export default function ConfidenceVsRealityChart({ data }: Props) {
  const safeData = Array.isArray(data) ? data : [];
  const hasData = safeData.some((d) => d.total > 0);
  const chartData = safeData.map((d) => ({
    name: d.bucket,
    הצלחה: d.success_rate_pct,
    סהכ: d.total,
  }));

  if (!hasData) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-500 text-sm rounded-lg border border-slate-700 bg-slate-800/50" dir="rtl">
        אין עדיין נתונים להצגה. התחזיות שאומתו יופיעו כאן.
      </div>
    );
  }

  return (
    <div className="w-full h-56" dir="rtl">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: 'rgb(148, 163, 184)', fontSize: 12 }}
            axisLine={{ stroke: 'rgb(71, 85, 105)' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: 'rgb(148, 163, 184)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{ backgroundColor: 'rgb(30, 41, 59)', border: '1px solid rgb(51, 65, 85)', borderRadius: '8px', fontSize: '12px' }}
            labelStyle={{ color: 'rgb(203, 213, 225)' }}
            formatter={(value: number) => [`${value}%`, 'שיעור הצלחה']}
            labelFormatter={(_, payload) => payload[0]?.payload?.name ? `הסתברות ${payload[0].payload.name}` : ''}
          />
          <Bar dataKey="הצלחה" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {chartData.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.הצלחה >= 50 ? BAR_COLOR : BAR_COLOR_LOW}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
