/**
 * Portfolio History — daily equity snapshots for Equity Curve and growth tracking.
 * Elite Terminal v1.3: Daily CRON records equity_value = cash + open_positions.
 * All numeric fields stored as NUMERIC; use Decimal.js when computing MDD/Calmar.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface PortfolioHistoryRow {
  id: number;
  snapshot_date: string;
  equity_value: number;
  created_at: string;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

/**
 * Insert or upsert daily equity snapshot. Call from CRON once per day.
 */
export async function insertPortfolioHistorySnapshot(equityValue: number): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    await sql`
      INSERT INTO portfolio_history (snapshot_date, equity_value)
      VALUES (${today}, ${equityValue})
      ON CONFLICT (snapshot_date) DO UPDATE SET equity_value = EXCLUDED.equity_value, created_at = NOW()
    `;
    const { rows } = await sql`SELECT id FROM portfolio_history WHERE snapshot_date = ${today} LIMIT 1`;
    const id = (rows?.[0] as { id: number })?.id;
    return id != null ? Number(id) : 0;
  } catch (err) {
    console.error('insertPortfolioHistorySnapshot failed:', err);
    return 0;
  }
}

/**
 * List equity snapshots in date range for Equity Curve visualization.
 */
export async function listPortfolioHistoryInRange(fromDate: string, toDate: string): Promise<PortfolioHistoryRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, snapshot_date::text, equity_value::float, created_at::text
      FROM portfolio_history
      WHERE snapshot_date >= ${fromDate} AND snapshot_date <= ${toDate}
      ORDER BY snapshot_date ASC
    `;
    return (rows || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      snapshot_date: String(r.snapshot_date),
      equity_value: Number(r.equity_value),
      created_at: String(r.created_at),
    })) as PortfolioHistoryRow[];
  } catch (err) {
    console.error('listPortfolioHistoryInRange failed:', err);
    return [];
  }
}
