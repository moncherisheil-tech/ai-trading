'use client';

import { useEffect, useRef, useState } from 'react';

type FxPayload = {
  ok?: boolean;
  dxy?: number;
  eurUsd?: number;
  usdIls?: number;
  updatedAt?: string;
};

function fmt(n: number | undefined, digits: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function deltaClass(delta: number | undefined): string {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return 'text-zinc-300';
  if (delta > 0) return 'text-emerald-400';
  return 'text-rose-400';
}

function fmtDelta(delta: number | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return '';
  if (delta === 0) return '0.00%';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(2)}%`;
}

type PairRowProps = {
  label: string;
  sub?: string;
  value: number | undefined;
  digits: number;
  deltaPct?: number;
};

function PairBlock({ label, sub, value, digits, deltaPct }: PairRowProps) {
  return (
    <div
      className="rounded-lg border border-zinc-700/80 bg-zinc-950/80 px-3 py-2 min-w-[5.5rem] flex-1 shadow-sm"
      dir="ltr"
    >
      <div className="text-[9px] font-semibold uppercase tracking-widest text-zinc-400 mb-0.5">{label}</div>
      {sub ? <div className="text-[8px] text-zinc-600 mb-1">{sub}</div> : null}
      <div className="flex flex-col gap-0.5">
        <span className="ticker-numeric text-sm font-semibold text-zinc-50 tabular-nums">{fmt(value, digits)}</span>
        {deltaPct != null && Number.isFinite(deltaPct) ? (
          <span className={`ticker-numeric text-[11px] font-medium tabular-nums ${deltaClass(deltaPct)}`}>
            {fmtDelta(deltaPct)}
          </span>
        ) : (
          <span className="text-[10px] text-zinc-600">—</span>
        )}
      </div>
    </div>
  );
}

export default function ForexTicker({ collapsed }: { collapsed?: boolean }) {
  const [data, setData] = useState<FxPayload | null>(null);
  const prevRef = useRef<FxPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/market/forex', { cache: 'no-store' });
        const j = (await res.json()) as FxPayload;
        if (cancelled) return;
        setData((current) => {
          prevRef.current = current;
          return j;
        });
      } catch {
        if (!cancelled) {
          setData((current) => {
            prevRef.current = current;
            return { ok: false };
          });
        }
      }
    };
    void load();
    const id = setInterval(load, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const prev = prevRef.current;
  const pct = (cur: number | undefined, old: number | undefined): number | undefined => {
    if (cur == null || old == null || !Number.isFinite(cur) || !Number.isFinite(old) || old === 0) return undefined;
    return ((cur - old) / old) * 100;
  };

  if (collapsed) {
    return (
      <div
        className="frosted-obsidian rounded-xl bg-zinc-950/40 px-2 py-1.5 text-center border border-zinc-700/50"
        title="שער מט״ח"
      >
        <span className="ticker-numeric text-[9px] font-semibold text-cyan-200/95 tabular-nums">FX</span>
      </div>
    );
  }

  return (
    <div className="frosted-obsidian rounded-xl bg-zinc-950/50 border border-zinc-700/60 px-3 py-2.5 shadow-inner space-y-2.5" dir="rtl">
      <p className="text-[10px] font-bold tracking-wide text-amber-500/95 mb-0 text-center sm:text-start leading-snug">
        מדד ה־DXY ושערי חליפין (חי)
      </p>
      <div className="rounded-lg border border-amber-500/25 bg-black/30 px-2 py-2" dir="ltr">
        <p className="text-[8px] font-semibold uppercase tracking-widest text-amber-400/80 mb-1.5 text-end" dir="rtl">
          מדד מטבע (DXY)
        </p>
        <PairBlock
          label="DXY"
          sub="US Dollar Index"
          value={data?.dxy}
          digits={2}
          deltaPct={pct(data?.dxy, prev?.dxy)}
        />
      </div>
      <div className="rounded-lg border border-cyan-500/20 bg-black/25 px-2 py-2" dir="ltr">
        <p className="text-[8px] font-semibold uppercase tracking-widest text-cyan-400/80 mb-1.5 text-end" dir="rtl">
          זוגות מט״ח
        </p>
        <div className="flex flex-wrap gap-2 justify-center sm:justify-start items-stretch">
          <PairBlock
            label="EUR/USD"
            value={data?.eurUsd}
            digits={4}
            deltaPct={pct(data?.eurUsd, prev?.eurUsd)}
          />
          <PairBlock
            label="USD/ILS"
            value={data?.usdIls}
            digits={3}
            deltaPct={pct(data?.usdIls, prev?.usdIls)}
          />
        </div>
      </div>
      {data?.ok === false && (
        <p className="text-[10px] text-rose-400/90 text-center sm:text-start" dir="rtl">
          שירות מט״ח זמנית לא זמין
        </p>
      )}
    </div>
  );
}
