/**
 * AI Learning Ledger — Long-Term Memory for continuous accuracy improvement.
 * Persisted in Vercel Postgres so the system can query historical error margins across serverless invocations.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface AiLearningLedgerRow {
  id: number;
  prediction_id: string;
  timestamp: string;
  symbol: string;
  predicted_price: number;
  actual_price: number;
  error_margin_pct: number;
  ai_conclusion: string | null;
  created_at: string;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

async function ensureTable(): Promise<boolean> {
  if (!usePostgres()) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS ai_learning_ledger (
        id SERIAL PRIMARY KEY,
        prediction_id VARCHAR(255) NOT NULL UNIQUE,
        timestamp TIMESTAMPTZ NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        predicted_price DECIMAL(24,8) NOT NULL,
        actual_price DECIMAL(24,8) NOT NULL,
        error_margin_pct DECIMAL(12,6) NOT NULL,
        ai_conclusion TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_learning_ledger_timestamp ON ai_learning_ledger(timestamp)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_learning_ledger_prediction_id ON ai_learning_ledger(prediction_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_learning_ledger_symbol ON ai_learning_ledger(symbol)`;
    return true;
  } catch (err) {
    console.error('ai_learning_ledger ensureTable failed:', err);
    return false;
  }
}

export interface InsertLearningLedgerInput {
  prediction_id: string;
  timestamp: string;
  symbol: string;
  predicted_price: number;
  actual_price: number;
  error_margin_pct: number;
  ai_conclusion: string | null;
}

/**
 * Insert one row into the AI learning ledger (idempotent: ON CONFLICT DO NOTHING).
 * Returns true if inserted, false if prediction_id already existed.
 */
export async function insertLearningLedgerRow(row: InsertLearningLedgerInput): Promise<boolean> {
  if (!usePostgres()) return false;
  try {
    const ok = await ensureTable();
    if (!ok) return false;
    const created = new Date().toISOString();
    const result = await sql`
      INSERT INTO ai_learning_ledger (prediction_id, timestamp, symbol, predicted_price, actual_price, error_margin_pct, ai_conclusion, created_at)
      VALUES (${row.prediction_id}, ${row.timestamp}, ${row.symbol}, ${row.predicted_price}, ${row.actual_price}, ${row.error_margin_pct}, ${row.ai_conclusion}, ${created})
      ON CONFLICT (prediction_id) DO NOTHING
    `;
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    console.error('insertLearningLedgerRow failed:', err);
    return false;
  }
}

/**
 * Bulk insert from historical prediction rows. Skips duplicates by prediction_id.
 * Returns count of newly inserted rows.
 */
export async function syncHistoricalToLedger(
  rows: Array<{
    prediction_id: string;
    evaluated_at: string;
    symbol: string;
    entry_price: number;
    actual_price: number;
    absolute_error_pct: number;
    bottom_line_he: string | null;
    outcome_label: string;
  }>
): Promise<number> {
  let inserted = 0;
  for (const r of rows) {
    const aiConclusion = r.bottom_line_he?.trim() || `${r.outcome_label}`;
    const ok = await insertLearningLedgerRow({
      prediction_id: r.prediction_id,
      timestamp: r.evaluated_at,
      symbol: r.symbol,
      predicted_price: r.entry_price,
      actual_price: r.actual_price,
      error_margin_pct: r.absolute_error_pct,
      ai_conclusion: aiConclusion || null,
    });
    if (ok) inserted++;
  }
  return inserted;
}

/** Query ledger by symbol for confidence calibration. */
export async function getLedgerBySymbol(symbol: string, limit = 100): Promise<AiLearningLedgerRow[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const { rows } = await sql`
      SELECT id, prediction_id, timestamp::text, symbol, predicted_price::float, actual_price::float, error_margin_pct::float, ai_conclusion, created_at::text
      FROM ai_learning_ledger WHERE symbol = ${symbol} ORDER BY timestamp DESC LIMIT ${limit}
    `;
    return (rows || []).map(mapLedgerRow) as AiLearningLedgerRow[];
  } catch (err) {
    console.error('getLedgerBySymbol failed:', err);
    return [];
  }
}

/** Get recent ledger rows for global error stats. */
export async function getRecentLedger(limit = 200): Promise<AiLearningLedgerRow[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const { rows } = await sql`
      SELECT id, prediction_id, timestamp::text, symbol, predicted_price::float, actual_price::float, error_margin_pct::float, ai_conclusion, created_at::text
      FROM ai_learning_ledger ORDER BY timestamp DESC LIMIT ${limit}
    `;
    return (rows || []).map(mapLedgerRow) as AiLearningLedgerRow[];
  } catch (err) {
    console.error('getRecentLedger failed:', err);
    return [];
  }
}

function mapLedgerRow(r: Record<string, unknown>): AiLearningLedgerRow {
  return {
    id: Number(r.id),
    prediction_id: String(r.prediction_id),
    timestamp: String(r.timestamp),
    symbol: String(r.symbol),
    predicted_price: Number(r.predicted_price),
    actual_price: Number(r.actual_price),
    error_margin_pct: Number(r.error_margin_pct),
    ai_conclusion: r.ai_conclusion != null ? String(r.ai_conclusion) : null,
    created_at: String(r.created_at),
  };
}
