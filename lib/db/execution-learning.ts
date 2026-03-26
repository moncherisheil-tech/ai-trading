import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export type TradeExecutionType = 'PAPER' | 'LIVE';
export type TradeExecutionSide = 'BUY' | 'SELL';
export type TradeExecutionStatus = 'OPEN' | 'CLOSED' | 'FAILED';

export interface TradeExecutionRow {
  id: string;
  symbol: string;
  alpha_signal_id: string | null;
  type: TradeExecutionType;
  side: TradeExecutionSide;
  amount: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number | null;
  status: TradeExecutionStatus;
  executed_at: string;
  closed_at: string | null;
}

export interface LearnedInsightRow {
  id: string;
  trade_id: string;
  failure_reason: string;
  academy_reference: string | null;
  adjustment_applied: boolean;
  created_at: string;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

export async function ensureExecutionLearningTables(): Promise<boolean> {
  if (!usePostgres()) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS trade_executions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        alpha_signal_id TEXT,
        type TEXT NOT NULL CHECK (type IN ('PAPER', 'LIVE')),
        side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        amount NUMERIC(24,8) NOT NULL,
        entry_price NUMERIC(24,8) NOT NULL,
        exit_price NUMERIC(24,8),
        pnl NUMERIC(24,8),
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'FAILED')),
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_trade_exec_symbol_executed_at ON trade_executions(symbol, executed_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_trade_exec_status_executed_at ON trade_executions(status, executed_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS learned_insights (
        id TEXT PRIMARY KEY,
        trade_id TEXT NOT NULL REFERENCES trade_executions(id) ON DELETE CASCADE,
        failure_reason TEXT NOT NULL,
        academy_reference TEXT,
        adjustment_applied BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_learned_insights_trade_created ON learned_insights(trade_id, created_at DESC)`;
    return true;
  } catch (err) {
    console.error('[execution-learning] ensure table failed:', err);
    return false;
  }
}

export async function insertTradeExecution(input: {
  id: string;
  symbol: string;
  alphaSignalId?: string | null;
  type: TradeExecutionType;
  side: TradeExecutionSide;
  amount: number;
  entryPrice: number;
  status?: TradeExecutionStatus;
}): Promise<TradeExecutionRow | null> {
  const ok = await ensureExecutionLearningTables();
  if (!ok) return null;
  const status = input.status ?? 'OPEN';
  const { rows } = await sql`
    INSERT INTO trade_executions (
      id, symbol, alpha_signal_id, type, side, amount, entry_price, status, executed_at
    )
    VALUES (
      ${input.id}, ${input.symbol}, ${input.alphaSignalId ?? null}, ${input.type}, ${input.side},
      ${input.amount}, ${input.entryPrice}, ${status}, NOW()
    )
    RETURNING *
  `;
  return mapTradeRow(rows?.[0] as Record<string, unknown> | undefined);
}

export async function closeTradeExecution(input: {
  id: string;
  exitPrice: number;
  pnl: number;
  status?: TradeExecutionStatus;
}): Promise<TradeExecutionRow | null> {
  const ok = await ensureExecutionLearningTables();
  if (!ok) return null;
  const status = input.status ?? 'CLOSED';
  const { rows } = await sql`
    UPDATE trade_executions
    SET exit_price = ${input.exitPrice}, pnl = ${input.pnl}, status = ${status}, closed_at = NOW()
    WHERE id = ${input.id}
    RETURNING *
  `;
  return mapTradeRow(rows?.[0] as Record<string, unknown> | undefined);
}

export async function markTradeExecutionFailed(id: string, pnl = 0): Promise<TradeExecutionRow | null> {
  const ok = await ensureExecutionLearningTables();
  if (!ok) return null;
  const { rows } = await sql`
    UPDATE trade_executions
    SET status = 'FAILED', pnl = ${pnl}, closed_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return mapTradeRow(rows?.[0] as Record<string, unknown> | undefined);
}

export async function getTradeExecutionById(id: string): Promise<TradeExecutionRow | null> {
  const ok = await ensureExecutionLearningTables();
  if (!ok) return null;
  const { rows } = await sql`SELECT * FROM trade_executions WHERE id = ${id} LIMIT 1`;
  return mapTradeRow(rows?.[0] as Record<string, unknown> | undefined);
}

export async function listRecentTradeExecutions(limit = 50): Promise<TradeExecutionRow[]> {
  const ok = await ensureExecutionLearningTables();
  if (!ok) return [];
  const { rows } = await sql`SELECT * FROM trade_executions ORDER BY executed_at DESC LIMIT ${limit}`;
  return (rows || [])
    .map((r: Record<string, unknown>) => mapTradeRow(r))
    .filter((r): r is TradeExecutionRow => r != null);
}

export async function insertLearnedInsight(input: {
  id: string;
  tradeId: string;
  failureReason: string;
  academyReference?: string | null;
  adjustmentApplied?: boolean;
}): Promise<LearnedInsightRow | null> {
  const ok = await ensureExecutionLearningTables();
  if (!ok) return null;
  const { rows } = await sql`
    INSERT INTO learned_insights (id, trade_id, failure_reason, academy_reference, adjustment_applied, created_at)
    VALUES (${input.id}, ${input.tradeId}, ${input.failureReason}, ${input.academyReference ?? null}, ${input.adjustmentApplied ?? false}, NOW())
    RETURNING *
  `;
  return mapInsightRow(rows?.[0] as Record<string, unknown> | undefined);
}

export async function listRecentLearnedInsights(limit = 50): Promise<LearnedInsightRow[]> {
  const ok = await ensureExecutionLearningTables();
  if (!ok) return [];
  const { rows } = await sql`SELECT * FROM learned_insights ORDER BY created_at DESC LIMIT ${limit}`;
  return (rows || [])
    .map((r: Record<string, unknown>) => mapInsightRow(r))
    .filter((r): r is LearnedInsightRow => r != null);
}

function mapTradeRow(row?: Record<string, unknown>): TradeExecutionRow | null {
  if (!row) return null;
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    alpha_signal_id: row.alpha_signal_id != null ? String(row.alpha_signal_id) : null,
    type: String(row.type) as TradeExecutionType,
    side: String(row.side) as TradeExecutionSide,
    amount: Number(row.amount),
    entry_price: Number(row.entry_price),
    exit_price: row.exit_price != null ? Number(row.exit_price) : null,
    pnl: row.pnl != null ? Number(row.pnl) : null,
    status: String(row.status) as TradeExecutionStatus,
    executed_at: new Date(String(row.executed_at)).toISOString(),
    closed_at: row.closed_at != null ? new Date(String(row.closed_at)).toISOString() : null,
  };
}

function mapInsightRow(row?: Record<string, unknown>): LearnedInsightRow | null {
  if (!row) return null;
  return {
    id: String(row.id),
    trade_id: String(row.trade_id),
    failure_reason: String(row.failure_reason),
    academy_reference: row.academy_reference != null ? String(row.academy_reference) : null,
    adjustment_applied: Boolean(row.adjustment_applied),
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}
