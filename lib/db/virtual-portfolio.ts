/**
 * Virtual portfolio (paper trading) persisted in Vercel Postgres.
 * All PnL and percentage math uses Decimal.js to avoid floating-point errors.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';
import { round2, toDecimal, D } from '@/lib/decimal';
import type { ScalpRiskTier } from '@/lib/trading/scalp-tiers';

export type VirtualTradeStatus = 'open' | 'closed';
export type CloseReason = 'take_profit' | 'stop_loss' | 'liquidation' | 'manual';
export type VirtualTradeSource = 'manual' | 'agent';

export interface AgentExecState {
  scaleOutDone?: boolean;
  peakUnrealizedPct?: number;
  effectiveStopLossPct?: number;
  kellyFraction?: number;
  scalpTier?: ScalpRiskTier;
}

export interface VirtualPortfolioRow {
  id: number;
  symbol: string;
  entry_price: number;
  amount_usd: number;
  entry_date: string;
  status: VirtualTradeStatus;
  target_profit_pct: number;
  stop_loss_pct: number;
  closed_at: string | null;
  exit_price: number | null;
  pnl_pct: number | null;
  close_reason: CloseReason | null;
  source: VirtualTradeSource;
  entry_fee_usd?: number | null;
  exit_fee_usd?: number | null;
  pnl_net_usd?: number | null;
  exec_state?: AgentExecState | null;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

export interface InsertVirtualTradeInput {
  symbol: string;
  entry_price: number;
  amount_usd: number;
  target_profit_pct?: number;
  stop_loss_pct?: number;
  source?: VirtualTradeSource;
  exec_state?: AgentExecState | null;
}

export async function insertVirtualTrade(row: InsertVirtualTradeInput): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const entryDate = new Date().toISOString();
    const targetPct = row.target_profit_pct ?? 2;
    const stopPct = row.stop_loss_pct ?? -1.5;
    const src = row.source === 'agent' ? 'agent' : 'manual';
    const entryFeeUsd = toDecimal(row.amount_usd).times(D.entryFeeRate).toNumber();
    const execJson = JSON.stringify(row.exec_state && Object.keys(row.exec_state).length ? row.exec_state : {});
    const { rows } = await sql`
      INSERT INTO virtual_portfolio (symbol, entry_price, amount_usd, entry_date, status, target_profit_pct, stop_loss_pct, source, entry_fee_usd, exec_state)
      VALUES (${row.symbol}, ${row.entry_price}, ${row.amount_usd}, ${entryDate}, 'open', ${targetPct}, ${stopPct}, ${src}, ${entryFeeUsd}, ${execJson}::jsonb)
      ON CONFLICT (id) DO UPDATE
        SET
          symbol = EXCLUDED.symbol,
          entry_price = EXCLUDED.entry_price,
          amount_usd = EXCLUDED.amount_usd,
          entry_date = EXCLUDED.entry_date,
          status = EXCLUDED.status,
          target_profit_pct = EXCLUDED.target_profit_pct,
          stop_loss_pct = EXCLUDED.stop_loss_pct,
          source = EXCLUDED.source,
          exec_state = EXCLUDED.exec_state
      RETURNING id
    `;
    const id = (rows?.[0] as { id: number })?.id;
    return id != null ? Number(id) : 0;
  } catch (err) {
    console.error('insertVirtualTrade failed:', err);
    return 0;
  }
}

export async function closeVirtualTrade(
  id: number,
  exitPrice: number,
  closeReason: CloseReason = 'manual'
): Promise<{ pnlPct: number; pnlNetUsd: number } | null> {
  if (!usePostgres()) return null;
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return null;
  try {
    const { rows } = await sql`
      SELECT entry_price, amount_usd, COALESCE(entry_fee_usd, 0) as entry_fee_usd
      FROM virtual_portfolio WHERE id = ${id} AND status = 'open'
    `;
    const row = rows?.[0] as { entry_price: number; amount_usd: number; entry_fee_usd: number } | undefined;
    if (!row) return null;
    const entry = toDecimal(row.entry_price);
    const exit = toDecimal(exitPrice);
    const amountUsd = toDecimal(row.amount_usd);
    if (entry.isZero() || amountUsd.lte(0)) return null;
    const amountUnits = amountUsd.div(entry);
    const entryFeeUsd = toDecimal(row.entry_fee_usd ?? 0).gt(0)
      ? toDecimal(row.entry_fee_usd)
      : amountUsd.times(D.entryFeeRate);
    const exitFeeUsd = amountUnits.times(exit).times(D.exitFeeRate);
    const grossPnlUsd = exit.minus(entry).times(amountUnits);
    const totalFees = entryFeeUsd.plus(exitFeeUsd);
    const pnlNetUsd = grossPnlUsd.minus(totalFees);
    const pnlPct = amountUsd.gt(0)
      ? round2(pnlNetUsd.div(amountUsd).times(100).toDecimalPlaces(8))
      : 0;
    const closedAt = new Date().toISOString();
    const reason = ['take_profit', 'stop_loss', 'liquidation', 'manual'].includes(closeReason) ? closeReason : 'manual';
    const entryFeeFinal = round2(entryFeeUsd);
    await sql`
      UPDATE virtual_portfolio SET status = 'closed', closed_at = ${closedAt}, exit_price = ${exitPrice},
        pnl_pct = ${pnlPct}, close_reason = ${reason},
        entry_fee_usd = ${entryFeeFinal}, exit_fee_usd = ${round2(exitFeeUsd)}, pnl_net_usd = ${round2(pnlNetUsd)}
      WHERE id = ${id}
    `;
    return { pnlPct, pnlNetUsd: round2(pnlNetUsd) };
  } catch (err) {
    console.error('closeVirtualTrade failed:', err);
    return null;
  }
}

export async function listOpenVirtualTrades(): Promise<VirtualPortfolioRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, symbol, entry_price::float, amount_usd::float, entry_date, status, target_profit_pct::float, stop_loss_pct::float, closed_at::text, exit_price::float, pnl_pct::float, close_reason::text, COALESCE(source, 'manual') as source, entry_fee_usd::float, exit_fee_usd::float, pnl_net_usd::float,
      COALESCE(exec_state::text, '{}') as exec_state_json
      FROM virtual_portfolio WHERE status = 'open' ORDER BY entry_date DESC
    `;
    return (rows || []).map(mapRow) as VirtualPortfolioRow[];
  } catch (err) {
    console.error('listOpenVirtualTrades failed:', err);
    return [];
  }
}

export async function listClosedVirtualTrades(limit = 200): Promise<VirtualPortfolioRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, symbol, entry_price::float, amount_usd::float, entry_date, status, target_profit_pct::float, stop_loss_pct::float, closed_at::text, exit_price::float, pnl_pct::float, close_reason::text, COALESCE(source, 'manual') as source, entry_fee_usd::float, exit_fee_usd::float, pnl_net_usd::float,
      COALESCE(exec_state::text, '{}') as exec_state_json
      FROM virtual_portfolio WHERE status = 'closed' ORDER BY closed_at DESC LIMIT ${limit}
    `;
    return (rows || []).map(mapRow) as VirtualPortfolioRow[];
  } catch (err) {
    console.error('listClosedVirtualTrades failed:', err);
    return [];
  }
}

/** Closed trades with closed_at within the given date range (inclusive). */
export async function listClosedVirtualTradesInRange(fromDate: string, toDate: string): Promise<VirtualPortfolioRow[]> {
  if (!usePostgres()) return [];
  try {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
    const { rows } = await sql`
      SELECT id, symbol, entry_price::float, amount_usd::float, entry_date, status, target_profit_pct::float, stop_loss_pct::float, closed_at::text, exit_price::float, pnl_pct::float, close_reason::text, COALESCE(source, 'manual') as source, entry_fee_usd::float, exit_fee_usd::float, pnl_net_usd::float,
      COALESCE(exec_state::text, '{}') as exec_state_json
      FROM virtual_portfolio
      WHERE status = 'closed' AND closed_at >= ${from.toISOString()} AND closed_at <= ${to.toISOString()}
      ORDER BY closed_at ASC
    `;
    return (rows || []).map(mapRow) as VirtualPortfolioRow[];
  } catch (err) {
    console.error('listClosedVirtualTradesInRange failed:', err);
    return [];
  }
}

export async function listAllVirtualTrades(limit = 500): Promise<VirtualPortfolioRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, symbol, entry_price::float, amount_usd::float, entry_date, status, target_profit_pct::float, stop_loss_pct::float, closed_at::text, exit_price::float, pnl_pct::float, close_reason::text, COALESCE(source, 'manual') as source, entry_fee_usd::float, exit_fee_usd::float, pnl_net_usd::float,
      COALESCE(exec_state::text, '{}') as exec_state_json
      FROM virtual_portfolio ORDER BY entry_date DESC LIMIT ${limit}
    `;
    return (rows || []).map(mapRow) as VirtualPortfolioRow[];
  } catch (err) {
    console.error('listAllVirtualTrades failed:', err);
    return [];
  }
}

export async function getVirtualTradeById(id: number): Promise<VirtualPortfolioRow | null> {
  if (!usePostgres()) return null;
  try {
    const { rows } = await sql`
      SELECT id, symbol, entry_price::float, amount_usd::float, entry_date, status, target_profit_pct::float, stop_loss_pct::float, closed_at::text, exit_price::float, pnl_pct::float, close_reason::text, COALESCE(source, 'manual') as source, entry_fee_usd::float, exit_fee_usd::float, pnl_net_usd::float,
      COALESCE(exec_state::text, '{}') as exec_state_json
      FROM virtual_portfolio WHERE id = ${id}
    `;
    const r = rows?.[0];
    return r ? mapRow(r as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Delete all rows from virtual_portfolio (zero-state for production launch).
 */
export async function deleteAllVirtualTrades(): Promise<{ deleted: number }> {
  if (!usePostgres()) return { deleted: 0 };
  try {
    const { rowCount } = await sql`DELETE FROM virtual_portfolio`;
    return { deleted: rowCount ?? 0 };
  } catch (err) {
    console.error('deleteAllVirtualTrades failed:', err);
    return { deleted: 0 };
  }
}

const SCALP_TIERS: ScalpRiskTier[] = ['CAUTIOUS', 'MODERATE', 'DANGEROUS'];

export function parseExecState(raw: unknown): AgentExecState {
  if (raw == null) return {};
  const s = typeof raw === 'string' ? raw : String(raw);
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return {};
    const tierRaw = o.scalpTier;
    const scalpTier =
      typeof tierRaw === 'string' && SCALP_TIERS.includes(tierRaw as ScalpRiskTier)
        ? (tierRaw as ScalpRiskTier)
        : undefined;
    return {
      scaleOutDone: Boolean(o.scaleOutDone),
      peakUnrealizedPct: typeof o.peakUnrealizedPct === 'number' ? o.peakUnrealizedPct : undefined,
      effectiveStopLossPct: typeof o.effectiveStopLossPct === 'number' ? o.effectiveStopLossPct : undefined,
      kellyFraction: typeof o.kellyFraction === 'number' && Number.isFinite(o.kellyFraction) ? o.kellyFraction : undefined,
      scalpTier,
    };
  } catch {
    return {};
  }
}

/** Merge-patch exec_state for open agent trades (trailing stop / scale-out bookkeeping). */
export async function patchVirtualTradeExecState(id: number, patch: Partial<AgentExecState>): Promise<void> {
  if (!usePostgres()) return;
  const row = await getVirtualTradeById(id);
  if (!row || row.status !== 'open') return;
  const prev = row.exec_state ?? {};
  const next: AgentExecState = { ...prev, ...patch };
  const json = JSON.stringify(next);
  try {
    await sql`UPDATE virtual_portfolio SET exec_state = ${json}::jsonb WHERE id = ${id} AND status = 'open'`;
  } catch (err) {
    console.error('patchVirtualTradeExecState failed:', err);
  }
}

/** Paper sim: halve notional after first take-profit tranche; marks scaleOutDone. */
export async function applyAgentScaleOutHalf(id: number): Promise<void> {
  if (!usePostgres()) return;
  try {
    await sql`
      UPDATE virtual_portfolio SET
        amount_usd = amount_usd * 0.5,
        entry_fee_usd = COALESCE(entry_fee_usd, 0) * 0.5,
        exec_state = COALESCE(exec_state, '{}'::jsonb) || ${JSON.stringify({ scaleOutDone: true })}::jsonb
      WHERE id = ${id} AND status = 'open' AND COALESCE(source, 'manual') = 'agent'
    `;
  } catch (err) {
    console.error('applyAgentScaleOutHalf failed:', err);
  }
}

export async function listClosedVirtualTradesBySource(source: VirtualTradeSource, symbol?: string, limit = 200): Promise<VirtualPortfolioRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } =
      symbol != null
        ? await sql`
            SELECT id, symbol, entry_price::float, amount_usd::float, entry_date, status, target_profit_pct::float, stop_loss_pct::float, closed_at::text, exit_price::float, pnl_pct::float, close_reason::text, COALESCE(source, 'manual') as source, entry_fee_usd::float, exit_fee_usd::float, pnl_net_usd::float,
            COALESCE(exec_state::text, '{}') as exec_state_json
            FROM virtual_portfolio WHERE status = 'closed' AND COALESCE(source, 'manual') = ${source} AND symbol = ${symbol} ORDER BY closed_at DESC LIMIT ${limit}
          `
        : await sql`
            SELECT id, symbol, entry_price::float, amount_usd::float, entry_date, status, target_profit_pct::float, stop_loss_pct::float, closed_at::text, exit_price::float, pnl_pct::float, close_reason::text, COALESCE(source, 'manual') as source, entry_fee_usd::float, exit_fee_usd::float, pnl_net_usd::float,
            COALESCE(exec_state::text, '{}') as exec_state_json
            FROM virtual_portfolio WHERE status = 'closed' AND COALESCE(source, 'manual') = ${source} ORDER BY closed_at DESC LIMIT ${limit}
          `;
    return (rows || []).map((r: Record<string, unknown>) => mapRow(r)) as VirtualPortfolioRow[];
  } catch (err) {
    console.error('listClosedVirtualTradesBySource failed:', err);
    return [];
  }
}

function mapRow(r: Record<string, unknown>): VirtualPortfolioRow {
  const reason = r.close_reason as string | null | undefined;
  const closeReason: VirtualPortfolioRow['close_reason'] =
    reason && ['take_profit', 'stop_loss', 'liquidation', 'manual'].includes(reason)
      ? (reason as CloseReason)
      : null;
  const src = r.source as string | undefined;
  const source: VirtualTradeSource = src === 'agent' ? 'agent' : 'manual';
  const execJson = r.exec_state_json;
  return {
    id: Number(r.id),
    symbol: String(r.symbol),
    entry_price: Number(r.entry_price),
    amount_usd: Number(r.amount_usd),
    entry_date: String(r.entry_date),
    status: (r.status as string) as VirtualTradeStatus,
    target_profit_pct: Number(r.target_profit_pct),
    stop_loss_pct: Number(r.stop_loss_pct),
    closed_at: r.closed_at != null ? String(r.closed_at) : null,
    exit_price: r.exit_price != null ? Number(r.exit_price) : null,
    pnl_pct: r.pnl_pct != null ? Number(r.pnl_pct) : null,
    close_reason: closeReason,
    source,
    entry_fee_usd: r.entry_fee_usd != null ? Number(r.entry_fee_usd) : null,
    exit_fee_usd: r.exit_fee_usd != null ? Number(r.exit_fee_usd) : null,
    pnl_net_usd: r.pnl_net_usd != null ? Number(r.pnl_net_usd) : null,
    exec_state: execJson != null ? parseExecState(execJson) : {},
  };
}
