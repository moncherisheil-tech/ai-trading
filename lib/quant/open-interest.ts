/**
 * Shared Open Interest (OI) enrichment: Binance Futures OI fetch + mapping to candles.
 * Single source of truth for backtest engine and live scanner.
 */

import { APP_CONFIG } from '@/lib/config';
import { fetchWithBackoff } from '@/lib/api-utils';

const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const OI_PERIOD_4H = '4h';
const OI_LIMIT_PER_REQUEST = 500;

export interface OpenInterestRow {
  timestamp: number;
  sumOpenInterest: number;
}

export interface RawKlineRow {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type OIStatus = 'Rising' | 'Falling' | 'Stable';

export interface OIEnrichment {
  oiChangePct: number | null;
  oiStatus: OIStatus;
}

const OI_STABLE_THRESHOLD_PCT = 0.3;

/**
 * Fetches Open Interest history from Binance Futures API (4h period to match candles).
 * Paginates by OI_LIMIT_PER_REQUEST; handles rate limits via fetchWithBackoff.
 * Non-fatal: callers should catch and continue without OI on failure.
 */
export async function fetchOpenInterest(
  symbol: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<OpenInterestRow[]> {
  const rows: OpenInterestRow[] = [];
  const finalStart = Math.floor(startTimeMs);
  const finalEnd = Math.floor(endTimeMs);
  let from = finalStart;

  while (from < finalEnd) {
    const url = `${BINANCE_FUTURES_BASE}/futures/data/openInterestHist?symbol=${encodeURIComponent(
      symbol
    )}&period=${OI_PERIOD_4H}&limit=${OI_LIMIT_PER_REQUEST}&startTime=${from}&endTime=${finalEnd}`;
    const res = await fetchWithBackoff(url, {
      timeoutMs: APP_CONFIG.fetchTimeoutMs,
      maxRetries: 3,
      cache: 'no-store',
    });
    if (!res.ok) {
      break;
    }
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json) || json.length === 0) {
      break;
    }
    for (const row of json as Array<{ timestamp?: number; sumOpenInterest?: string }>) {
      const ts = typeof row?.timestamp === 'number' ? row.timestamp : null;
      const oi = row?.sumOpenInterest != null ? parseFloat(String(row.sumOpenInterest)) : NaN;
      if (ts != null && Number.isFinite(oi)) {
        rows.push({ timestamp: ts, sumOpenInterest: oi });
      }
    }
    const last = rows[rows.length - 1];
    if (!last) break;
    const next = last.timestamp + 4 * 60 * 60 * 1000;
    if (next <= from) break;
    from = next;
  }

  return rows.filter((r) => r.timestamp >= finalStart && r.timestamp <= finalEnd);
}

function findClosestOI(candleOpenTime: number, oiRows: OpenInterestRow[]): number | null {
  if (oiRows.length === 0) return null;
  let best = oiRows[0]!;
  let bestDiff = Math.abs(best.timestamp - candleOpenTime);
  for (let i = 1; i < oiRows.length; i++) {
    const r = oiRows[i]!;
    const d = Math.abs(r.timestamp - candleOpenTime);
    if (d < bestDiff) {
      bestDiff = d;
      best = r;
    }
  }
  return best.sumOpenInterest;
}

/** OI change % and status for one candle (vs previous candle). */
export function getOIEnrichmentForCandle(
  candleOpenTime: number,
  klines: RawKlineRow[],
  oiRows: OpenInterestRow[]
): OIEnrichment {
  if (oiRows.length === 0) {
    return { oiChangePct: null, oiStatus: 'Stable' };
  }
  const idx = klines.findIndex((k) => k.openTime === candleOpenTime);
  if (idx < 0) return { oiChangePct: null, oiStatus: 'Stable' };

  const prevOpenTime = idx > 0 ? klines[idx - 1]!.openTime : null;
  const currentOI = findClosestOI(candleOpenTime, oiRows);
  const previousOI = prevOpenTime != null ? findClosestOI(prevOpenTime, oiRows) : null;

  if (currentOI == null) {
    return { oiChangePct: null, oiStatus: 'Stable' };
  }
  if (previousOI == null || previousOI === 0) {
    return { oiChangePct: null, oiStatus: 'Stable' };
  }
  const oiChangePct = ((currentOI - previousOI) / previousOI) * 100;
  const oiStatus: OIStatus =
    oiChangePct > OI_STABLE_THRESHOLD_PCT
      ? 'Rising'
      : oiChangePct < -OI_STABLE_THRESHOLD_PCT
        ? 'Falling'
        : 'Stable';
  return { oiChangePct, oiStatus };
}

/** Format OI enrichment as signal string for ConsensusEngineInput.open_interest_signal. */
export function formatOISignal(enrichment: OIEnrichment): string | null {
  if (enrichment.oiChangePct == null) return null;
  const pct = Math.round(enrichment.oiChangePct * 100) / 100;
  return `Open Interest Status: ${enrichment.oiStatus}. OI Change: ${enrichment.oiChangePct >= 0 ? '+' : ''}${pct}%`;
}
