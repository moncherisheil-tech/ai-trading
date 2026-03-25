'use client';

import { useMemo } from 'react';
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
import { Sparkles } from 'lucide-react';

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

function ema(values: number[], period: number): (number | null)[] {
  if (values.length < period) return values.map(() => null);
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(values.length);
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period; i++) result[i] = null;
  for (let i = period; i < values.length; i++) {
    emaVal = values[i]! * k + emaVal * (1 - k);
    result[i] = emaVal;
  }
  return result;
}

function rsiFromCloses(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const slice = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i]! - slice[i - 1]!;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export default function PriceHistoryChart({
  data,
  executionMarkers = [],
  eliteCandleIndex,
}: {
  data: ChartRow[];
  executionMarkers?: ExecutionMarker[];
  /** When set, shows a gold "Elite Signal" icon on this candle index (e.g. last candle when brain detected spike). */
  eliteCandleIndex?: number;
}) {
  const chartDataWithIndicators = useMemo(() => {
    const closes = data.map((d) => d.close);
    const ema20Arr = ema(closes, 20);
    const ema50Arr = ema(closes, 50);
    return data.map((row, i) => ({
      ...row,
      ema20: ema20Arr[i] ?? undefined,
      ema50: ema50Arr[i] ?? undefined,
    }));
  }, [data]);

  const rsi14 = useMemo(() => {
    const closes = data.map((d) => d.close);
    return rsiFromCloses(closes, 14);
  }, [data]);

  const eliteCandle = useMemo(() => {
    if (eliteCandleIndex == null || eliteCandleIndex < 0 || eliteCandleIndex >= chartDataWithIndicators.length)
      return null;
    const row = chartDataWithIndicators[eliteCandleIndex];
    return row ? { x: row.date, y: row.close } : null;
  }, [chartDataWithIndicators, eliteCandleIndex]);

  const markersWithX = executionMarkers.map((m) => ({
    ...m,
    x: findClosestDate(data, m.date),
  }));

  return (
    <div className="w-full h-full flex flex-col gap-1 min-w-0 min-h-0" style={{ minWidth: 0, minHeight: 0 }}>
      {/* RSI (14) text indicator */}
      {data.length >= 15 && (
        <div className="flex items-center justify-end gap-2 px-1 text-xs">
          <span className="text-zinc-500">RSI (14):</span>
          <span
            className={`font-mono font-semibold tabular-nums ${
              rsi14 >= 70 ? 'text-rose-400' : rsi14 <= 30 ? 'text-emerald-400' : 'text-zinc-300'
            }`}
          >
            {rsi14.toFixed(1)}
          </span>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%" className="min-h-[180px] sm:min-h-[220px]">
        <LineChart data={chartDataWithIndicators} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(51 65 85)" opacity={0.5} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'rgb(148 163 184)' }}
            axisLine={false}
            tickLine={false}
            minTickGap={20}
          />
          <YAxis
            orientation="right"
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
              textAlign: 'right',
              direction: 'rtl',
              zIndex: 9999,
            }}
            formatter={(value, name) => {
              const seriesName = String(name ?? '');
              const label =
                seriesName === 'close' ? 'מחיר' : seriesName === 'ema20' ? 'EMA 20' : seriesName === 'ema50' ? 'EMA 50' : seriesName;
              return [`$${Number(value ?? 0).toLocaleString()}`, label];
            }}
            labelStyle={{ color: 'rgb(203 213 225)' }}
            wrapperStyle={{ direction: 'rtl', zIndex: 9999 }}
          />
          <Line
            type="monotone"
            dataKey="close"
            stroke="rgb(16 185 129)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: 'rgb(16 185 129)', stroke: 'rgb(15 23 42)', strokeWidth: 2 }}
            name="close"
          />
          {chartDataWithIndicators.some((d) => d.ema20 != null) && (
            <Line
              type="monotone"
              dataKey="ema20"
              stroke="rgb(34 211 238)"
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="4 2"
              name="ema20"
            />
          )}
          {chartDataWithIndicators.some((d) => d.ema50 != null) && (
            <Line
              type="monotone"
              dataKey="ema50"
              stroke="rgb(251 146 60)"
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="4 2"
              name="ema50"
            />
          )}
          {markersWithX.map((m, idx) => (
            <ReferenceDot
              key={`${m.type}-${m.x}-${m.price}-${idx}`}
              x={m.x}
              y={m.price}
              r={6}
              fill={m.type === 'buy' ? 'rgb(52 211 153)' : 'rgb(244 63 94)'}
              stroke="rgb(15 23 42)"
              strokeWidth={2}
            />
          ))}
          {eliteCandle && (
            <ReferenceDot
              x={eliteCandle.x}
              y={eliteCandle.y}
              r={10}
              fill="rgba(251, 191, 36, 0.9)"
              stroke="rgb(245 158 11)"
              strokeWidth={2}
              className="opacity-95"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      {eliteCandle && (
        <div className="flex items-center justify-end gap-1.5 px-1 text-[10px] text-amber-400">
          <Sparkles className="w-3 h-3" />
          <span>איתות עוצמתי (Elite)</span>
        </div>
      )}
    </div>
  );
}
