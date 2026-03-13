'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
} from 'recharts';

export type ChartRow = {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type ExecutionMarker = {
  type: 'buy' | 'sell';
  price: number;
  date: string;
  amountAsset?: number;
};

function findClosestDate(data: ChartRow[], targetDate: string): string {
  if (!data.length) return targetDate;
  const targetTime = new Date(targetDate).getTime();
  let closest = data[0];
  let minDiff = Math.abs(new Date(data[0].date).getTime() - targetTime);
  for (let i = 1; i < data.length; i++) {
    const diff = Math.abs(new Date(data[i].date).getTime() - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closest = data[i];
    }
  }
  return closest.date;
}

export default function PriceHistoryChart({
  data,
  executionMarkers = [],
}: {
  data: ChartRow[];
  executionMarkers?: ExecutionMarker[];
}) {
  const markersWithX = executionMarkers.map((m) => ({
    ...m,
    x: findClosestDate(data, m.date),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%" className="min-h-[200px] sm:min-h-[240px]">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(51 65 85)" opacity={0.5} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: 'rgb(148 163 184)' }}
          axisLine={false}
          tickLine={false}
          minTickGap={20}
        />
        <YAxis
          domain={['auto', 'auto']}
          tick={{ fontSize: 10, fill: 'rgb(148 163 184)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(val) => `$${Number(val).toLocaleString()}`}
          width={56}
        />
        <Tooltip
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid rgb(51 65 85)',
            backgroundColor: 'rgb(30 41 59)',
            color: 'rgb(248 250 252)',
          }}
          formatter={(value: number) => [`$${Number(value).toLocaleString()}`, 'מחיר']}
          labelStyle={{ color: 'rgb(203 213 225)' }}
        />
        <Line
          type="monotone"
          dataKey="close"
          stroke="rgb(16 185 129)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, fill: 'rgb(16 185 129)', stroke: 'rgb(15 23 42)', strokeWidth: 2 }}
        />
        {markersWithX.map((m, idx) => (
          <ReferenceDot
            key={`${m.type}-${m.x}-${m.price}-${idx}`}
            x={m.x}
            y={m.price}
            r={6}
            fill={m.type === 'buy' ? 'rgb(34 197 94)' : 'rgb(239 68 68)'}
            stroke="rgb(15 23 42)"
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
