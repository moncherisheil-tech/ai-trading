'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

type ChartRow = {
  date: string;
  close: number;
};

export default function PriceHistoryChart({ data }: { data: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={20} />
        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val.toLocaleString()}`} width={60} />
        <Tooltip
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          itemStyle={{ color: '#0f172a', fontWeight: 500 }}
          formatter={(value) => [`$${Number(value ?? 0).toLocaleString()}`, 'Price']}
        />
        <Line type="monotone" dataKey="close" stroke="#4f46e5" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
