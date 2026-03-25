'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getTradingMetricsAction } from '@/app/actions';

type MetricsPoint = {
  date: string;
  total_trades: number;
  profitable_trades: number;
  prediction_matches: number;
  resolved_accuracy_trades: number;
  win_rate_pct: number;
  prediction_accuracy_pct: number;
};

type MetricsResponse = {
  success: boolean;
  days: number;
  data: MetricsPoint[];
  error?: string;
};

type ChartPoint = MetricsPoint & {
  label: string;
  moving_avg_7d: number;
};

const TIMEFRAMES = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
] as const;

type TimeframeDays = (typeof TIMEFRAMES)[number]['days'];

function formatDayMonth(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function AIAccuracyChart() {
  const [rows, setRows] = useState<MetricsPoint[]>([]);
  const [timeframeDays, setTimeframeDays] = useState<TimeframeDays>(90);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(!hasLoadedOnceRef.current);
        setIsRefreshing(hasLoadedOnceRef.current);
        setError(null);
        const out = await getTradingMetricsAction({ days: timeframeDays });
        if (!out.success) {
          if (mounted) setError(out.error);
          return;
        }
        const payload = out.data as MetricsResponse;
        if (!payload?.success) {
          if (mounted) setError(payload?.error || 'Failed to load AI learning metrics.');
          return;
        }
        if (mounted) {
          setRows(Array.isArray(payload.data) ? payload.data : []);
          hasLoadedOnceRef.current = true;
        }
      } catch {
        if (mounted) setError('Failed to load AI learning metrics.');
      } finally {
        if (mounted) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [timeframeDays]);

  const chartData = useMemo<ChartPoint[]>(() => {
    const winSeries: number[] = [];
    return rows.map((row, index) => {
      winSeries.push(row.win_rate_pct);
      const start = Math.max(0, index - 6);
      const window = winSeries.slice(start, index + 1);
      const avg = window.length > 0 ? window.reduce((sum, n) => sum + n, 0) / window.length : 0;
      return {
        ...row,
        label: formatDayMonth(row.date),
        moving_avg_7d: round2(avg),
      };
    });
  }, [rows]);

  const latest = chartData[chartData.length - 1] ?? null;

  return (
    <section className="frosted-obsidian sovereign-tilt z-depth-2 rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-[#071320] to-[#040b14] p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-cyan-100">AI Learning Curve</h3>
          <p className="text-xs text-zinc-400">
            Daily win rate vs 7-day moving average
          </p>
        </div>
        {latest && (
          <div className="text-right">
            <div className="text-xs text-zinc-500">Latest Prediction Accuracy</div>
            <div className="text-sm font-semibold text-emerald-300 live-data-number">
              {latest.prediction_accuracy_pct.toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 inline-flex items-center gap-1 rounded-lg border border-cyan-400/20 bg-[#020a12]/80 p-1">
        {TIMEFRAMES.map((option) => {
          const active = timeframeDays === option.days;
          return (
            <button
              key={option.days}
              type="button"
              onClick={() => setTimeframeDays(option.days)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide live-data-number transition-all ${
                active
                  ? 'bg-cyan-400/20 text-cyan-200 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]'
                  : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
              }`}
              aria-pressed={active}
              aria-label={`Show ${option.label} learning curve`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="h-72 animate-pulse rounded-xl border border-white/10 bg-white/[0.02]" />
      ) : error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error}
        </div>
      ) : chartData.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-zinc-400">
          No trade history yet. Execute paper trades to build the AI learning curve.
        </div>
      ) : (
        <div className="relative h-80 w-full transition-opacity duration-300">
          {isRefreshing && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[#02101b]/45 backdrop-blur-[1px]">
              <div className="rounded-md border border-cyan-400/30 bg-[#061422]/90 px-2.5 py-1 text-[11px] font-medium text-cyan-200">
                Updating...
              </div>
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.2)" />
              <XAxis
                dataKey="label"
                tick={{ fill: 'rgb(161 161 170)', fontSize: 11, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: 'rgb(161 161 170)', fontSize: 11, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(5, 16, 28, 0.96)',
                  border: '1px solid rgba(34, 211, 238, 0.25)',
                  borderRadius: '10px',
                  color: 'rgb(226 232 240)',
                  fontSize: '12px',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                }}
                labelStyle={{ color: 'rgb(186 230 253)', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
                formatter={(value, name) => {
                  const v = typeof value === 'number' ? value : Number(value ?? 0);
                  const n = String(name);
                  if (n === 'win_rate_pct') return [`${v.toFixed(1)}%`, 'Daily Win Rate'];
                  if (n === 'moving_avg_7d') return [`${v.toFixed(1)}%`, '7-Day Moving Avg'];
                  if (n === 'prediction_accuracy_pct') {
                    return [`${v.toFixed(1)}%`, 'Prediction Accuracy'];
                  }
                  return [String(value ?? ''), n];
                }}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as ChartPoint | undefined;
                  return row ? `${row.label} • ${row.total_trades} trades` : '';
                }}
              />
              <Legend
                wrapperStyle={{ color: 'rgb(186 230 253)', fontSize: '12px', fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}
                formatter={(value) =>
                  value === 'win_rate_pct' ? 'Daily Win Rate' : value === 'moving_avg_7d' ? '7-Day Moving Avg' : value
                }
              />
              <Line
                type="monotone"
                dataKey="win_rate_pct"
                stroke="#22d3ee"
                strokeWidth={2.2}
                dot={{ r: 2.5, fill: '#22d3ee' }}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="moving_avg_7d"
                stroke="#22c55e"
                strokeWidth={2.6}
                dot={false}
                strokeDasharray="7 4"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
