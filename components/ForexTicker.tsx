'use client';

import { useEffect, useState } from 'react';

type FxPayload = {
  ok?: boolean;
  dxy?: number;
  eurUsd?: number;
  usdIls?: number;
  updatedAt?: string;
};

const PANEL = 'frosted-obsidian rounded-xl bg-zinc-950/40';

function fmt(n: number | undefined, digits: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default function ForexTicker({ collapsed }: { collapsed?: boolean }) {
  const [data, setData] = useState<FxPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/market/forex', { cache: 'no-store' });
        const j = (await res.json()) as FxPayload;
        if (!cancelled) setData(j);
      } catch {
        if (!cancelled) setData({ ok: false });
      }
    };
    void load();
    const id = setInterval(load, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (collapsed) {
    return (
      <div className={`${PANEL} px-2 py-1.5 text-[9px] font-mono tabular-nums text-cyan-200/90 text-center`} title="Forex uplink">
        FX
      </div>
    );
  }

  return (
    <div className={`${PANEL} px-3 py-2`} dir="ltr">
      <p className="text-[9px] font-bold uppercase tracking-[0.28em] text-cyan-500/70 mb-1">Forex uplink</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono tabular-nums text-zinc-200">
        <span>
          <span className="text-zinc-500">DXY</span> {fmt(data?.dxy, 2)}
        </span>
        <span>
          <span className="text-zinc-500">EUR/USD</span> {fmt(data?.eurUsd, 4)}
        </span>
        <span>
          <span className="text-zinc-500">USD/ILS</span> {fmt(data?.usdIls, 3)}
        </span>
      </div>
    </div>
  );
}
