/**
 * SQLite table virtual_portfolio for paper trading.
 * Symbol, Entry Price, Amount (Virtual $), Entry Date, Status (Open/Closed).
 * Optional target_profit_pct and stop_loss_pct for auto-close.
 */

import path from 'path';
import { APP_CONFIG } from '@/lib/config';

export type VirtualTradeStatus = 'open' | 'closed';

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
}

type DatabaseCtor = new (filename: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { lastInsertRowid: number };
    all(...args: unknown[]): VirtualPortfolioRow[];
  };
};

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS virtual_portfolio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  entry_price REAL NOT NULL,
  amount_usd REAL NOT NULL,
  entry_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  target_profit_pct REAL NOT NULL DEFAULT 2,
  stop_loss_pct REAL NOT NULL DEFAULT -1.5,
  closed_at TEXT,
  exit_price REAL,
  pnl_pct REAL
);
CREATE INDEX IF NOT EXISTS idx_virtual_portfolio_status ON virtual_portfolio(status);
CREATE INDEX IF NOT EXISTS idx_virtual_portfolio_entry_date ON virtual_portfolio(entry_date);
`;

let dbInstance: InstanceType<DatabaseCtor> | null = null;

function getDb(): InstanceType<DatabaseCtor> {
  if (typeof process !== 'undefined' && process.env.VERCEL) {
    throw new Error('SQLite is not available on Vercel. Use DATABASE_URL (Postgres) instead.');
  }
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    throw new Error('virtual_portfolio is only available when DB_DRIVER=sqlite');
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

export interface InsertVirtualTradeInput {
  symbol: string;
  entry_price: number;
  amount_usd: number;
  target_profit_pct?: number;
  stop_loss_pct?: number;
}

export function insertVirtualTrade(row: InsertVirtualTradeInput): number {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return 0;
  const db = getDb();
  const entryDate = new Date().toISOString();
  const targetPct = row.target_profit_pct ?? 2;
  const stopPct = row.stop_loss_pct ?? -1.5;
  const stmt = db.prepare(
    `INSERT INTO virtual_portfolio (symbol, entry_price, amount_usd, entry_date, status, target_profit_pct, stop_loss_pct)
     VALUES (?, ?, ?, ?, 'open', ?, ?)`
  );
  const result = stmt.run(row.symbol, row.entry_price, row.amount_usd, entryDate, targetPct, stopPct);
  return Number(result.lastInsertRowid);
}

export function closeVirtualTrade(id: number, exitPrice: number): void {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return;
  const db = getDb();
  const row = db.prepare('SELECT entry_price FROM virtual_portfolio WHERE id = ? AND status = ?').all(id, 'open')[0] as { entry_price: number } | undefined;
  if (!row) return;
  const pnlPct = ((exitPrice - row.entry_price) / row.entry_price) * 100;
  const closedAt = new Date().toISOString();
  db.prepare(
    'UPDATE virtual_portfolio SET status = ?, closed_at = ?, exit_price = ?, pnl_pct = ? WHERE id = ?'
  ).run('closed', closedAt, exitPrice, pnlPct, id);
}

export function listOpenVirtualTrades(): VirtualPortfolioRow[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  return db.prepare('SELECT * FROM virtual_portfolio WHERE status = ? ORDER BY entry_date DESC').all('open') as VirtualPortfolioRow[];
}

export function listClosedVirtualTrades(limit = 200): VirtualPortfolioRow[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  return db.prepare('SELECT * FROM virtual_portfolio WHERE status = ? ORDER BY closed_at DESC LIMIT ?').all('closed', limit) as VirtualPortfolioRow[];
}

export function listAllVirtualTrades(limit = 500): VirtualPortfolioRow[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  return db.prepare('SELECT * FROM virtual_portfolio ORDER BY entry_date DESC LIMIT ?').all(limit) as VirtualPortfolioRow[];
}
