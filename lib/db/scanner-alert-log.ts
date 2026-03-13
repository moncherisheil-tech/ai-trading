/**
 * Scanner alert log: records gems alerted by the live scanning worker.
 * Used for dashboard "Total Gems found today" and 4h dedup (avoid re-alerting same symbol).
 */

import path from 'path';
import { APP_CONFIG } from '@/lib/config';

export interface ScannerAlertLogRow {
  id: number;
  symbol: string;
  prediction_id: string;
  probability: number;
  entry_price: number;
  alerted_at: string;
}

type DatabaseCtor = new (filename: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { lastInsertRowid: number };
    all(...args: unknown[]): ScannerAlertLogRow[];
  };
};

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS scanner_alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  prediction_id TEXT NOT NULL,
  probability REAL NOT NULL,
  entry_price REAL NOT NULL,
  alerted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scanner_alert_log_alerted_at ON scanner_alert_log(alerted_at);
CREATE INDEX IF NOT EXISTS idx_scanner_alert_log_symbol ON scanner_alert_log(symbol);
`;

let dbInstance: InstanceType<DatabaseCtor> | null = null;

function getDb(): InstanceType<DatabaseCtor> {
  if (typeof process !== 'undefined' && process.env.VERCEL) {
    throw new Error('SQLite is not available on Vercel. Use DATABASE_URL (Postgres) instead.');
  }
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    throw new Error('scanner_alert_log is only available when DB_DRIVER=sqlite');
  }
  if (!dbInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require('better-sqlite3') as DatabaseCtor;
    const filePath = path.join(process.cwd(), APP_CONFIG.sqlitePath);
    dbInstance = new BetterSqlite3(filePath);
    dbInstance.exec(TABLE_SQL);
  }
  return dbInstance;
}

export function insertScannerAlert(params: {
  symbol: string;
  prediction_id: string;
  probability: number;
  entry_price: number;
}): void {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return;
  const db = getDb();
  db.prepare(
    `INSERT INTO scanner_alert_log (symbol, prediction_id, probability, entry_price, alerted_at) VALUES (?, ?, ?, ?, ?)`
  ).run(
    params.symbol,
    params.prediction_id,
    params.probability,
    params.entry_price,
    new Date().toISOString()
  );
}

/** Count alerts for the current calendar day (local time). */
export function countScannerAlertsToday(): number {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return 0;
  const db = getDb();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const start = todayStart.toISOString();
  const end = todayEnd.toISOString();
  const rows = db.prepare(
    'SELECT id FROM scanner_alert_log WHERE alerted_at >= ? AND alerted_at < ?'
  ).all(start, end) as { id: number }[];
  return rows.length;
}

/** Symbols alerted in the last N milliseconds (for 4h dedup). */
export function getSymbolsAlertedSince(sinceMs: number): string[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  const since = new Date(Date.now() - sinceMs).toISOString();
  const rows = db.prepare(
    'SELECT DISTINCT symbol FROM scanner_alert_log WHERE alerted_at >= ?'
  ).all(since) as { symbol: string }[];
  return rows.map((r) => r.symbol);
}

/** Count alerts in the last N milliseconds (e.g. 24h for morning report). */
export function countScannerAlertsSince(sinceMs: number): number {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return 0;
  const db = getDb();
  const since = new Date(Date.now() - sinceMs).toISOString();
  const rows = db.prepare(
    'SELECT id FROM scanner_alert_log WHERE alerted_at >= ?'
  ).all(since) as { id: number }[];
  return rows.length;
}
