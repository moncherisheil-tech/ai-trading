/**
 * Scanner alert log: records gems alerted by the live scanning worker, persisted in Vercel Postgres.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface ScannerAlertLogRow {
  id: number;
  symbol: string;
  prediction_id: string;
  probability: number;
  entry_price: number;
  alerted_at: string;
}

export interface ScannerAlertLogRecentRow extends ScannerAlertLogRow {}

export interface ScannerAlertLogLatestRow {
  symbol: string;
  probability: number;
  entry_price: number;
  alerted_at: string;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

async function ensureTable(): Promise<boolean> {
  if (!usePostgres()) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS scanner_alert_log (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(32) NOT NULL,
        prediction_id VARCHAR(255) NOT NULL,
        probability DOUBLE PRECISION NOT NULL,
        entry_price DOUBLE PRECISION NOT NULL,
        alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_scanner_alert_log_alerted_at ON scanner_alert_log(alerted_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_scanner_alert_log_symbol ON scanner_alert_log(symbol)`;
    return true;
  } catch (err) {
    console.error('scanner_alert_log ensureTable failed:', err);
    return false;
  }
}

export async function insertScannerAlert(params: {
  symbol: string;
  prediction_id: string;
  probability: number;
  entry_price: number;
}): Promise<void> {
  if (!usePostgres()) return;
  try {
    const ok = await ensureTable();
    if (!ok) return;
    await sql`
      INSERT INTO scanner_alert_log (symbol, prediction_id, probability, entry_price, alerted_at)
      VALUES (${params.symbol}, ${params.prediction_id}, ${params.probability}, ${params.entry_price}, ${new Date().toISOString()})
    `;
  } catch (err) {
    console.error('insertScannerAlert failed:', err);
  }
}

export async function countScannerAlertsToday(): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const ok = await ensureTable();
    if (!ok) return 0;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const start = todayStart.toISOString();
    const end = todayEnd.toISOString();
    const { rows } = await sql`
      SELECT id FROM scanner_alert_log WHERE alerted_at >= ${start} AND alerted_at < ${end}
    `;
    return rows?.length ?? 0;
  } catch (err) {
    console.error('countScannerAlertsToday failed:', err);
    return 0;
  }
}

export async function getSymbolsAlertedSince(sinceMs: number): Promise<string[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const since = new Date(Date.now() - sinceMs).toISOString();
    const { rows } = await sql`
      SELECT DISTINCT symbol FROM scanner_alert_log WHERE alerted_at >= ${since}
    `;
    return (rows || []).map((r: Record<string, unknown>) => String(r.symbol));
  } catch (err) {
    console.error('getSymbolsAlertedSince failed:', err);
    return [];
  }
}

export async function getLatestScannerAlertForSymbol(symbol: string): Promise<ScannerAlertLogLatestRow | null> {
  if (!usePostgres()) return null;
  try {
    const ok = await ensureTable();
    if (!ok) return null;
    const { rows } = await sql`
      SELECT symbol, probability::float, entry_price::float, alerted_at::text
      FROM scanner_alert_log
      WHERE symbol = ${symbol}
      ORDER BY alerted_at DESC
      LIMIT 1
    `;
    const row = (rows || [])[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      symbol: String(row.symbol),
      probability: Number(row.probability),
      entry_price: Number(row.entry_price),
      alerted_at: String(row.alerted_at),
    };
  } catch (err) {
    console.error('getLatestScannerAlertForSymbol failed:', err);
    return null;
  }
}

/**
 * List most recently alerted distinct symbols since a given window.
 * Useful for executive reports (e.g. "Top gems from last 24h").
 */
export async function listRecentAlertedSymbolsSince(params: {
  sinceMs: number;
  limit?: number;
}): Promise<string[]> {
  if (!usePostgres()) return [];
  const limit = Math.max(1, Math.min(25, params.limit ?? 8));
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const since = new Date(Date.now() - params.sinceMs).toISOString();
    const { rows } = await sql`
      SELECT symbol, MAX(alerted_at) AS last_alert
      FROM scanner_alert_log
      WHERE alerted_at >= ${since}
      GROUP BY symbol
      ORDER BY last_alert DESC
      LIMIT ${limit}
    `;
    return (rows || []).map((r: Record<string, unknown>) => String(r.symbol));
  } catch (err) {
    console.error('listRecentAlertedSymbolsSince failed:', err);
    return [];
  }
}

export async function countScannerAlertsSince(sinceMs: number): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const ok = await ensureTable();
    if (!ok) return 0;
    const since = new Date(Date.now() - sinceMs).toISOString();
    const { rows } = await sql`
      SELECT id FROM scanner_alert_log WHERE alerted_at >= ${since}
    `;
    return rows?.length ?? 0;
  } catch (err) {
    console.error('countScannerAlertsSince failed:', err);
    return 0;
  }
}

/**
 * Recent scanner alerts with probability and timestamp.
 * Used by board-level analytics (volume anomaly proxy, liquidity trend).
 */
export async function listRecentScannerAlertsSince(params: {
  sinceMs: number;
  limit?: number;
}): Promise<ScannerAlertLogRecentRow[]> {
  if (!usePostgres()) return [];
  const limit = Math.max(1, Math.min(500, params.limit ?? 200));
  try {
    const ok = await ensureTable();
    if (!ok) return [];
    const since = new Date(Date.now() - params.sinceMs).toISOString();
    const { rows } = await sql`
      SELECT id, symbol, prediction_id, probability::float, entry_price::float, alerted_at::text
      FROM scanner_alert_log
      WHERE alerted_at >= ${since}
      ORDER BY alerted_at DESC
      LIMIT ${limit}
    `;
    return (rows || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      symbol: String(r.symbol),
      prediction_id: String(r.prediction_id),
      probability: Number(r.probability),
      entry_price: Number(r.entry_price),
      alerted_at: String(r.alerted_at),
    }));
  } catch (err) {
    console.error('listRecentScannerAlertsSince failed:', err);
    return [];
  }
}

/**
 * Delete all rows from scanner_alert_log (zero-state for production launch).
 * Ensures first production scan does not consider test alerts as "recently alerted".
 */
export async function deleteAllScannerAlertLog(): Promise<{ deleted: number }> {
  if (!usePostgres()) return { deleted: 0 };
  try {
    const ok = await ensureTable();
    if (!ok) return { deleted: 0 };
    const { rowCount } = await sql`DELETE FROM scanner_alert_log`;
    return { deleted: rowCount ?? 0 };
  } catch (err) {
    console.error('deleteAllScannerAlertLog failed:', err);
    return { deleted: 0 };
  }
}
