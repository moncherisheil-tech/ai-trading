import type { BinanceDepthSnapshot } from '@/lib/api-utils';

function levelUsdTopN(side: [string, string][], n: number): number {
  let s = 0;
  for (const [p, q] of side.slice(0, n)) {
    const pr = parseFloat(p);
    const qty = parseFloat(q);
    if (Number.isFinite(pr) && Number.isFinite(qty)) s += pr * qty;
  }
  return s;
}

/** Iceberg / ghost-liquidity hints from depth + optional resample (Binance REST). */
export function augmentOrderBookWithDepthHints(
  baseSummary: string,
  d1: BinanceDepthSnapshot | null,
  d2: BinanceDepthSnapshot | null
): string {
  if (!d1?.bids?.length || !d1?.asks?.length) return baseSummary;
  const bidTopUsd =
    (parseFloat(d1.bids[0]?.[0] ?? '0') || 0) * (parseFloat(d1.bids[0]?.[1] ?? '0') || 0);
  const askTopUsd =
    (parseFloat(d1.asks[0]?.[0] ?? '0') || 0) * (parseFloat(d1.asks[0]?.[1] ?? '0') || 0);
  const bidRest = Math.max(0, levelUsdTopN(d1.bids, 10) - bidTopUsd);
  const askRest = Math.max(0, levelUsdTopN(d1.asks, 10) - askTopUsd);
  const hints: string[] = [];
  if (bidRest > 1e-6 && bidTopUsd / bidRest > 0.45) hints.push('Iceberg-hint: outsized best bid vs deeper book.');
  if (askRest > 1e-6 && askTopUsd / askRest > 0.45) hints.push('Iceberg-hint: outsized best ask vs deeper book.');
  if (d2?.bids?.[0] && d1.bids[0]?.[0] && d1.bids[0][0] === d2.bids[0][0]) {
    const s1 = parseFloat(d1.bids[0][1]);
    const s2 = parseFloat(d2.bids[0][1]);
    if (Number.isFinite(s1) && Number.isFinite(s2) && s1 > 1e-8 && s2 / s1 < 0.35) {
      hints.push('Ghost-liquidity-hint: top bid size thinned on resample.');
    }
  }
  if (hints.length === 0) return baseSummary;
  return `${baseSummary} Depth-mastery: ${hints.join(' ')}`;
}
