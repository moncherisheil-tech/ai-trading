'use client';

import { useMemo, memo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { Info } from 'lucide-react';
import {
  computePortfolioAllocation,
  deriveRiskLevel,
  type PortfolioAllocationInput,
  type PortfolioAllocationResult,
} from '@/lib/portfolio-logic';
import { round2 } from '@/lib/decimal';

/** Simulation summary position shape (from /api/simulation/summary). */
export type SimSummaryPosition = {
  symbol: string;
  amountAsset: number;
  costUsd: number;
  currentPrice: number;
  unrealizedPnlUsd: number;
};

/** Props: either full allocation input or simulation summary for real-time use. */
export type PortfolioAllocationProps = {
  /** When provided, used directly (e.g. from virtual portfolio API). */
  allocationInput?: PortfolioAllocationInput | null;
  /** When provided, derived from simulation summary (wallet + positions with live prices). */
  simulationSummary?: {
    walletUsd: number;
    positions: SimSummaryPosition[];
  } | null;
  /** Compact mode for sidebar (smaller chart, fewer legend rows). */
  compact?: boolean;
  /** Optional class for wrapper. */
  className?: string;
};

const DEEP_SEA_COLORS = [
  'rgb(34, 211, 238)',   // cyan-400
  'rgb(103, 232, 249)',  // cyan-300
  'rgb(94, 234, 212)',   // teal-300
  'rgb(52, 211, 211)',   // teal-400
  'rgb(45, 212, 191)',   // teal-400 alt
  'rgb(20, 184, 166)',   // teal-500
  'rgb(94, 156, 180)',   // slate-400 (muted)
  'rgb(148, 163, 184)',  // slate-400
];

const LABELS = {
  title: 'התפלגות תיק',
  totalExposure: 'חשיפת שוק כוללת',
  assetConcentration: 'ריכוזיות נכסים',
  liquidBalance: 'יתרה נזילה',
  riskLevel: 'רמת סיכון',
  symbol: 'סמל',
  amount: 'כמות',
  pctOfPortfolio: '% מתיק',
  noData: 'אין נתוני תיק. בצע עסקאות סימולציה או חבר תיק וירטואלי.',
};

function buildInputFromSimSummary(summary: NonNullable<PortfolioAllocationProps['simulationSummary']>): PortfolioAllocationInput {
  return {
    liquidBalanceUsd: summary.walletUsd ?? 0,
    positions: (summary.positions ?? []).map((p) => ({
      symbol: p.symbol,
      currentValueUsd: round2((p.costUsd ?? 0) + (p.unrealizedPnlUsd ?? 0)),
      amountAsset: p.amountAsset ?? 0,
      costUsd: p.costUsd,
      unrealizedPnlUsd: p.unrealizedPnlUsd,
    })),
  };
}

function AllocationDonut({ result, compact }: { result: PortfolioAllocationResult; compact?: boolean }) {
  const chartData = useMemo(() => {
    return result.slices.map((s, i) => ({
      name: s.label,
      value: s.weightPct,
      currentValueUsd: s.currentValueUsd,
      amountAsset: s.amountAsset,
      fill: DEEP_SEA_COLORS[i % DEEP_SEA_COLORS.length],
    }));
  }, [result.slices]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center text-[var(--app-muted)] text-sm h-48">
        {LABELS.noData}
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row items-center justify-center gap-6 w-full min-w-0 min-h-0" style={{ minWidth: 0, minHeight: 0 }}>
      <ResponsiveContainer width="100%" height={compact ? 200 : 260}>
        <PieChart margin={{ top: 12, right: 12, left: 12, bottom: 12 }}>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={compact ? 48 : 64}
          outerRadius={compact ? 72 : 88}
          paddingAngle={1}
          dataKey="value"
          nameKey="name"
        >
          {chartData.map((entry, index) => (
            <Cell key={entry.name} fill={entry.fill} stroke="rgba(3, 15, 28, 0.6)" strokeWidth={1} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--app-surface)',
            border: '1px solid var(--app-border)',
            borderRadius: '12px',
            textAlign: 'right',
            direction: 'rtl',
            zIndex: 9999,
          }}
          wrapperStyle={{ fontSize: 11, zIndex: 9999 }}
          formatter={(value, name, props) => {
            const p = (props?.payload ?? {}) as { currentValueUsd?: number; amountAsset?: number };
            const usd = p?.currentValueUsd != null ? `$${p.currentValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '';
            const pct = `${Number(value ?? 0).toFixed(1)}%`;
            return [pct, `${String(name ?? '')} ${usd}`];
          }}
          labelFormatter={(label) => `${LABELS.symbol}: ${label}`}
        />
        <Legend
          layout="horizontal"
          align="center"
          verticalAlign="bottom"
          wrapperStyle={{ fontSize: 11 }}
          formatter={(value, entry) => {
            const payload = entry.payload as { currentValueUsd?: number; amountAsset?: number; value?: number };
            const amount = payload?.amountAsset;
            const pct = payload?.value != null ? `${Number(payload.value).toFixed(1)}%` : '';
            const usd = payload?.currentValueUsd != null ? `$${payload.currentValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '';
            if (value === 'יתרה נזילה') return [value, `${usd} · ${pct}`];
            return [value, `${amount != null ? amount.toLocaleString(undefined, { maximumFractionDigits: 6 }) : ''} · ${pct}`];
          }}
          iconType="circle"
          iconSize={8}
        />
      </PieChart>
    </ResponsiveContainer>
    </div>
  );
}

function ExposureBar({
  label,
  valuePct,
  tooltip,
  barColor,
}: {
  label: string;
  valuePct: number;
  tooltip: string;
  barColor: string;
}) {
  const pct = Math.min(100, Math.max(0, valuePct));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--app-muted)] flex items-center gap-1">
          {label}
          <span
            className="inline-flex text-[var(--app-muted)] opacity-80"
            title={tooltip}
            aria-label={tooltip}
          >
            <Info className="w-3.5 h-3.5" />
          </span>
        </span>
        <span dir="ltr" className="inline-block text-xs font-semibold tabular-nums text-[var(--app-text)]">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--app-border)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

function PortfolioAllocationInner({
  allocationInput,
  simulationSummary,
  compact = false,
  className = '',
}: PortfolioAllocationProps) {
  const result = useMemo((): PortfolioAllocationResult | null => {
    const input = allocationInput ?? (simulationSummary ? buildInputFromSimSummary(simulationSummary) : null);
    if (!input || (input.liquidBalanceUsd === 0 && input.positions.length === 0)) return null;
    return computePortfolioAllocation(input);
  }, [allocationInput, simulationSummary]);

  const riskLevel = result ? deriveRiskLevel(result.totalExposurePct, result.assetConcentrationPct) : 0;

  if (!result) {
    return (
      <section
        className={`rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-6 ${className}`}
        aria-label={LABELS.title}
        dir="rtl"
      >
        <h2 className="text-sm font-semibold text-[var(--app-muted)] uppercase tracking-wider mb-4 flex items-center gap-2">
          {LABELS.title}
        </h2>
        <div className="flex items-center justify-center text-[var(--app-muted)] text-sm py-8">
          {LABELS.noData}
        </div>
      </section>
    );
  }

  return (
    <section
      className={`rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 sm:p-6 shadow-lg ${className}`}
      aria-label={LABELS.title}
      dir="rtl"
    >
      <h2 className="text-sm font-semibold text-[var(--app-muted)] uppercase tracking-wider mb-4 flex items-center gap-2">
        {LABELS.title}
      </h2>

      <div className={`flex flex-col gap-4 min-w-0 min-h-0 ${compact ? '' : 'lg:flex-row lg:items-center lg:justify-center lg:gap-6'}`} style={{ minWidth: 0, minHeight: 0 }}>
        <div className="min-w-0 min-h-0 flex flex-col items-center justify-center">
          <AllocationDonut result={result} compact={compact} />
        </div>
        <div className="space-y-4 flex flex-col justify-center">
          <div className="text-center sm:text-right">
            <p className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider mb-0.5">
              {LABELS.liquidBalance}
            </p>
            <p className="text-xl font-bold text-[var(--app-text)] tabular-nums">
              <span dir="ltr" className="inline-block">${result.liquidBalanceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </p>
          </div>
          <ExposureBar
            label={LABELS.totalExposure}
            valuePct={result.totalExposurePct}
            tooltip="אחוז הערך התיק המושקע כרגע בפוזיציות פתוחות (לעומת מזומן)."
            barColor="rgb(34, 211, 238)"
          />
          <ExposureBar
            label={LABELS.riskLevel}
            valuePct={riskLevel}
            tooltip="מדד המבוסס על חשיפה וריכוזיות נכסים (אחוז הנכס הגדול ביותר)."
            barColor={riskLevel > 60 ? 'rgb(253, 186, 116)' : riskLevel > 35 ? 'rgb(251, 191, 36)' : 'rgb(34, 211, 238)'}
          />
          <div className="text-xs text-[var(--app-muted)]">
            <span className="font-medium">{LABELS.assetConcentration}:</span>{' '}
            <span dir="ltr" className="inline-block">{result.assetConcentrationPct.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {!compact && result.slices.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[var(--app-border)]">
          <p className="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider mb-2">
            {LABELS.symbol} · {LABELS.amount} · {LABELS.pctOfPortfolio}
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            {result.slices.map((s) => (
              <li key={s.symbol} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--app-bg)] px-3 py-2">
                <span className="font-medium text-[var(--app-text)]">{s.label}</span>
                <span dir="ltr" className="inline-block text-[var(--app-muted)] tabular-nums">
                  {s.symbol === 'CASH' ? `$${s.currentValueUsd.toFixed(2)}` : s.amountAsset.toLocaleString(undefined, { maximumFractionDigits: 6 })} · {s.weightPct.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default memo(PortfolioAllocationInner);
