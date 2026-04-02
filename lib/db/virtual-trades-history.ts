import { sql } from '@/lib/db/sql';
import { areTablesReady } from '@/lib/db/init-guard';
import { APP_CONFIG } from '@/lib/config';

export type ExecutionMode = 'PAPER' | 'LIVE';
export type ExecutionSignalSide = 'BUY' | 'SELL';
export type ExecutionStatus = 'executed' | 'blocked' | 'skipped' | 'failed';

export interface VirtualTradeHistoryRow {
  id: number;
  event_id: string;
  prediction_id: string | null;
  symbol: string;
  signal_side: ExecutionSignalSide;
  confidence: number;
  mode: ExecutionMode;
  executed: boolean;
  execution_status: ExecutionStatus;
  reason: string | null;
  overseer_summary: string | null;
  overseer_reasoning_path: string | null;
  expert_breakdown_json: string | null;
  execution_price: number | null;
  amount_usd: number | null;
  pnl_net_usd: number | null;
  virtual_trade_id: number | null;
  created_at: string;
}

export interface InsertVirtualTradeHistoryInput {
  eventId: string;
  predictionId?: string;
  symbol: string;
  signalSide: ExecutionSignalSide;
  confidence: number;
  mode: ExecutionMode;
  executed: boolean;
  executionStatus: ExecutionStatus;
  reason?: string | null;
  overseerSummary?: string | null;
  overseerReasoningPath?: string | null;
  expertBreakdownJson?: string | null;
  executionPrice?: number | null;
  amountUsd?: number | null;
  pnlNetUsd?: number | null;
  virtualTradeId?: number | null;
}

export interface ClosedTradeReinforcementRow {
  history_id: number;
  event_id: string;
  symbol: string;
  signal_side: string;
  confidence: number;
  closed_at: string;
  close_reason: string | null;
  pnl_net_usd: number;
  expert_breakdown_json: string | null;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

async function ensureClaimsTable(): Promise<boolean> {
  if (!usePostgres()) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS execution_pipeline_claims (
        event_id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_exec_claims_created ON execution_pipeline_claims (created_at)`;
    return true;
  } catch (err) {
    console.error('execution_pipeline_claims ensure failed:', err);
    return false;
  }
}

/**
 * Atomic claim before openVirtualTrade / TWAP so retries cannot double-open positions.
 * Stale claims older than 48h are purged so long-delayed replays can proceed.
 */
export async function tryClaimExecutionPipeline(eventId: string): Promise<boolean> {
  if (!usePostgres() || !eventId.trim()) return true;
  try {
    const ok = await ensureClaimsTable();
    if (!ok) return true;
    await sql`DELETE FROM execution_pipeline_claims WHERE created_at < NOW() - INTERVAL '48 hours'`;
    const { rows } = await sql`
      INSERT INTO execution_pipeline_claims (event_id) VALUES (${eventId.trim()})
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
    `;
    return (rows?.length ?? 0) > 0;
  } catch (err) {
    console.error('tryClaimExecutionPipeline failed:', err);
    return true;
  }
}

async function ensureTable(): Promise<boolean> {
  if (!usePostgres()) return false;
  // Short-circuit: Orchestrator already booted all tables sequentially.
  if (areTablesReady()) return true;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS virtual_trades_history (
        id SERIAL PRIMARY KEY,
        event_id TEXT UNIQUE NOT NULL,
        prediction_id TEXT,
        symbol TEXT NOT NULL,
        signal_side VARCHAR(8) NOT NULL CHECK (signal_side IN ('BUY', 'SELL')),
        confidence NUMERIC(10,4) NOT NULL,
        mode VARCHAR(8) NOT NULL CHECK (mode IN ('PAPER', 'LIVE')),
        executed BOOLEAN NOT NULL DEFAULT FALSE,
        execution_status VARCHAR(16) NOT NULL CHECK (execution_status IN ('executed', 'blocked', 'skipped', 'failed')),
        reason TEXT,
        overseer_summary TEXT,
        overseer_reasoning_path TEXT,
        expert_breakdown_json JSONB,
        execution_price NUMERIC(24,8),
        amount_usd NUMERIC(24,8),
        pnl_net_usd NUMERIC(24,8),
        virtual_trade_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE virtual_trades_history ADD COLUMN IF NOT EXISTS overseer_summary TEXT`;
    await sql`ALTER TABLE virtual_trades_history ADD COLUMN IF NOT EXISTS overseer_reasoning_path TEXT`;
    await sql`ALTER TABLE virtual_trades_history ADD COLUMN IF NOT EXISTS expert_breakdown_json JSONB`;
    await sql`ALTER TABLE virtual_trades_history ADD COLUMN IF NOT EXISTS pnl_net_usd NUMERIC(24,8)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_virtual_trades_history_created_at ON virtual_trades_history(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_virtual_trades_history_symbol ON virtual_trades_history(symbol)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_virtual_trades_history_prediction_id ON virtual_trades_history(prediction_id)`;
    return true;
  } catch (err) {
    console.error('virtual_trades_history ensureTable failed:', err);
    return false;
  }
}

export async function hasVirtualTradeExecutionEvent(eventId: string): Promise<boolean> {
  if (!usePostgres() || !eventId) return false;
  try {
    const ok = await ensureTable();
    if (!ok) return false;
    const { rows } = await sql`
      SELECT id FROM virtual_trades_history WHERE event_id = ${eventId} LIMIT 1
    `;
    return (rows?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export type InsertVirtualTradeHistoryResult = { id: number; inserted: boolean };

/**
 * Inserts one row per event_id. Retries with the same event_id do not overwrite (idempotent).
 */
export async function insertVirtualTradeHistory(input: InsertVirtualTradeHistoryInput): Promise<InsertVirtualTradeHistoryResult> {
  /** No persistence without Postgres — treat as successful insert so execution pipeline is not blocked. */
  if (!usePostgres()) return { id: 0, inserted: true };
  try {
    const ok = await ensureTable();
    if (!ok) return { id: 0, inserted: false };
    const { rows } = await sql`
      INSERT INTO virtual_trades_history (
        event_id, prediction_id, symbol, signal_side, confidence, mode, executed, execution_status, reason, overseer_summary, overseer_reasoning_path, expert_breakdown_json, execution_price, amount_usd, pnl_net_usd, virtual_trade_id
      )
      VALUES (
        ${input.eventId},
        ${input.predictionId ?? null},
        ${input.symbol},
        ${input.signalSide},
        ${input.confidence},
        ${input.mode},
        ${input.executed},
        ${input.executionStatus},
        ${input.reason ?? null},
        ${input.overseerSummary ?? null},
        ${input.overseerReasoningPath ?? null},
        ${input.expertBreakdownJson ?? null}::jsonb,
        ${input.executionPrice ?? null},
        ${input.amountUsd ?? null},
        ${input.pnlNetUsd ?? null},
        ${input.virtualTradeId ?? null}
      )
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `;
    const id = (rows?.[0] as { id: number } | undefined)?.id;
    if (id != null) return { id: Number(id), inserted: true };
    const { rows: existing } = await sql`
      SELECT id FROM virtual_trades_history WHERE event_id = ${input.eventId} LIMIT 1
    `;
    const existingId = (existing?.[0] as { id: number } | undefined)?.id;
    return { id: existingId != null ? Number(existingId) : 0, inserted: false };
  } catch (err) {
    console.error('insertVirtualTradeHistory failed:', err);
    return { id: 0, inserted: false };
  }
}

export async function listVirtualTradeHistory(limit = 50): Promise<VirtualTradeHistoryRow[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const { rows } = await sql`
      SELECT
        id,
        event_id,
        prediction_id,
        symbol,
        signal_side,
        confidence::float AS confidence,
        mode,
        executed,
        execution_status,
        reason,
        overseer_summary,
        overseer_reasoning_path,
        expert_breakdown_json::text AS expert_breakdown_json,
        execution_price::float AS execution_price,
        amount_usd::float AS amount_usd,
        pnl_net_usd::float AS pnl_net_usd,
        virtual_trade_id,
        created_at::text AS created_at
      FROM virtual_trades_history
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return (rows || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      event_id: String(r.event_id),
      prediction_id: r.prediction_id != null ? String(r.prediction_id) : null,
      symbol: String(r.symbol),
      signal_side: r.signal_side === 'SELL' ? 'SELL' : 'BUY',
      confidence: Number(r.confidence),
      mode: r.mode === 'LIVE' ? 'LIVE' : 'PAPER',
      executed: Boolean(r.executed),
      execution_status:
        r.execution_status === 'executed' ||
        r.execution_status === 'blocked' ||
        r.execution_status === 'skipped' ||
        r.execution_status === 'failed'
          ? (r.execution_status as ExecutionStatus)
          : 'failed',
      reason: r.reason != null ? String(r.reason) : null,
      overseer_summary: r.overseer_summary != null ? String(r.overseer_summary) : null,
      overseer_reasoning_path: r.overseer_reasoning_path != null ? String(r.overseer_reasoning_path) : null,
      expert_breakdown_json: r.expert_breakdown_json != null ? String(r.expert_breakdown_json) : null,
      execution_price: r.execution_price != null ? Number(r.execution_price) : null,
      amount_usd: r.amount_usd != null ? Number(r.amount_usd) : null,
      pnl_net_usd: r.pnl_net_usd != null ? Number(r.pnl_net_usd) : null,
      virtual_trade_id: r.virtual_trade_id != null ? Number(r.virtual_trade_id) : null,
      created_at: String(r.created_at ?? new Date().toISOString()),
    })) as VirtualTradeHistoryRow[];
  } catch (err) {
    console.error('listVirtualTradeHistory failed:', err);
    return [];
  }
}

export async function getLatestExecutedBuyForVirtualTrade(
  virtualTradeId: number
): Promise<VirtualTradeHistoryRow | null> {
  if (!usePostgres() || !Number.isFinite(virtualTradeId) || virtualTradeId <= 0) return null;
  try {
    const ok = await ensureTable();
    if (!ok) return null;
    const { rows } = await sql`
      SELECT
        id,
        event_id,
        prediction_id,
        symbol,
        signal_side,
        confidence::float AS confidence,
        mode,
        executed,
        execution_status,
        reason,
        overseer_summary,
        overseer_reasoning_path,
        expert_breakdown_json::text AS expert_breakdown_json,
        execution_price::float AS execution_price,
        amount_usd::float AS amount_usd,
        pnl_net_usd::float AS pnl_net_usd,
        virtual_trade_id,
        created_at::text AS created_at
      FROM virtual_trades_history
      WHERE virtual_trade_id = ${virtualTradeId}
        AND signal_side = 'BUY'
        AND executed = TRUE
        AND execution_status = 'executed'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const row = rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      event_id: String(row.event_id),
      prediction_id: row.prediction_id != null ? String(row.prediction_id) : null,
      symbol: String(row.symbol),
      signal_side: row.signal_side === 'SELL' ? 'SELL' : 'BUY',
      confidence: Number(row.confidence),
      mode: row.mode === 'LIVE' ? 'LIVE' : 'PAPER',
      executed: Boolean(row.executed),
      execution_status:
        row.execution_status === 'executed' ||
        row.execution_status === 'blocked' ||
        row.execution_status === 'skipped' ||
        row.execution_status === 'failed'
          ? (row.execution_status as ExecutionStatus)
          : 'failed',
      reason: row.reason != null ? String(row.reason) : null,
      overseer_summary: row.overseer_summary != null ? String(row.overseer_summary) : null,
      overseer_reasoning_path: row.overseer_reasoning_path != null ? String(row.overseer_reasoning_path) : null,
      expert_breakdown_json: row.expert_breakdown_json != null ? String(row.expert_breakdown_json) : null,
      execution_price: row.execution_price != null ? Number(row.execution_price) : null,
      amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
      pnl_net_usd: row.pnl_net_usd != null ? Number(row.pnl_net_usd) : null,
      virtual_trade_id: row.virtual_trade_id != null ? Number(row.virtual_trade_id) : null,
      created_at: String(row.created_at ?? new Date().toISOString()),
    };
  } catch (err) {
    console.error('getLatestExecutedBuyForVirtualTrade failed:', err);
    return null;
  }
}

export async function listClosedTradeReinforcementRows(daysBack = 7): Promise<ClosedTradeReinforcementRow[]> {
  if (!usePostgres()) return [];
  const safeDays = Number.isFinite(daysBack) ? Math.max(1, Math.floor(daysBack)) : 7;
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const { rows } = await sql`
      SELECT
        h.id AS history_id,
        h.event_id,
        h.symbol,
        h.signal_side,
        h.confidence::float AS confidence,
        p.closed_at::text AS closed_at,
        p.close_reason,
        p.pnl_net_usd::float AS pnl_net_usd,
        h.expert_breakdown_json::text AS expert_breakdown_json
      FROM virtual_trades_history h
      JOIN virtual_portfolio p
        ON p.id = h.virtual_trade_id
      WHERE h.executed = TRUE
        AND h.execution_status = 'executed'
        AND p.status = 'closed'
        AND p.closed_at >= NOW() - (${safeDays} * INTERVAL '1 day')
      ORDER BY p.closed_at DESC
    `;
    return (rows || []).map((row: Record<string, unknown>) => ({
      history_id: Number(row.history_id),
      event_id: String(row.event_id),
      symbol: String(row.symbol),
      signal_side: String(row.signal_side ?? 'BUY'),
      confidence: Number(row.confidence ?? 0),
      closed_at: String(row.closed_at ?? new Date().toISOString()),
      close_reason: row.close_reason != null ? String(row.close_reason) : null,
      pnl_net_usd: Number(row.pnl_net_usd ?? 0),
      expert_breakdown_json: row.expert_breakdown_json != null ? String(row.expert_breakdown_json) : null,
    }));
  } catch (err) {
    console.error('listClosedTradeReinforcementRows failed:', err);
    return [];
  }
}
