/**
 * Dynamic weights for P_success formula (Volume, RSI, Sentiment).
 * Stored in system_configs when DB_DRIVER=sqlite; weight_change_log records why weights changed (Log Lessons).
 */

import path from 'path';
import { APP_CONFIG } from '@/lib/config';

export const DEFAULT_WEIGHTS = { volume: 0.4, rsi: 0.3, sentiment: 0.3 };

export interface PredictionWeights {
  volume: number;
  rsi: number;
  sentiment: number;
}

export interface WeightSnapshot {
  date: string;
  success_rate_pct: number;
  volume_weight: number;
  rsi_weight: number;
  sentiment_weight: number;
}

export interface WeightChangeLogRow {
  id: number;
  created_at: string;
  reason_he: string;
  volume_weight: number;
  rsi_weight: number;
  sentiment_weight: number;
}

type DatabaseCtor = new (filename: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): void;
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Record<string, unknown>[];
  };
};

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS prediction_weights (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  volume_weight REAL NOT NULL DEFAULT 0.4,
  rsi_weight REAL NOT NULL DEFAULT 0.3,
  sentiment_weight REAL NOT NULL DEFAULT 0.3,
  updated_at TEXT NOT NULL,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS system_configs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  w_vol REAL NOT NULL DEFAULT 0.4,
  w_rsi REAL NOT NULL DEFAULT 0.3,
  w_sent REAL NOT NULL DEFAULT 0.3,
  updated_at TEXT NOT NULL,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS weight_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  reason_he TEXT NOT NULL,
  volume_weight REAL NOT NULL,
  rsi_weight REAL NOT NULL,
  sentiment_weight REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weight_change_log_created_at ON weight_change_log(created_at);
CREATE TABLE IF NOT EXISTS accuracy_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL UNIQUE,
  success_rate_pct REAL NOT NULL,
  volume_weight REAL NOT NULL,
  rsi_weight REAL NOT NULL,
  sentiment_weight REAL NOT NULL
);
INSERT OR IGNORE INTO prediction_weights (id, volume_weight, rsi_weight, sentiment_weight, updated_at, reason)
VALUES (1, 0.4, 0.3, 0.3, datetime('now'), 'Initial default');
INSERT OR IGNORE INTO system_configs (id, w_vol, w_rsi, w_sent, updated_at, reason)
VALUES (1, 0.4, 0.3, 0.3, datetime('now'), 'ערכי ברירת מחדל');
`;

let dbInstance: InstanceType<DatabaseCtor> | null = null;

function getDb(): InstanceType<DatabaseCtor> {
  if (typeof process !== 'undefined' && process.env.VERCEL) {
    throw new Error('SQLite is not available on Vercel. Use DATABASE_URL (Postgres) instead.');
  }
  if (APP_CONFIG.dbDriver !== 'sqlite') throw new Error('prediction_weights requires DB_DRIVER=sqlite');
  if (!dbInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require('better-sqlite3') as DatabaseCtor;
    const filePath = path.join(process.cwd(), APP_CONFIG.sqlitePath);
    dbInstance = new BetterSqlite3(filePath);
    dbInstance.exec(TABLE_SQL);
    // Migration: add ai_threshold_override to system_configs if missing (manual strategy override)
    try {
      const info = dbInstance.prepare('PRAGMA table_info(system_configs)').all() as Array<{ name: string }>;
      if (!info.some((c) => c.name === 'ai_threshold_override')) {
        dbInstance.prepare('ALTER TABLE system_configs ADD COLUMN ai_threshold_override INTEGER').run();
      }
    } catch {
      // ignore
    }
  }
  return dbInstance;
}

/** Reads active AI weights from system_configs (single source of truth); falls back to prediction_weights then default. */
export function getWeights(): PredictionWeights {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return { ...DEFAULT_WEIGHTS };
  const db = getDb();
  let row = db.prepare('SELECT w_vol, w_rsi, w_sent FROM system_configs WHERE id = 1').get() as { w_vol: number; w_rsi: number; w_sent: number } | undefined;
  if (!row) {
    row = db.prepare('SELECT volume_weight AS w_vol, rsi_weight AS w_rsi, sentiment_weight AS w_sent FROM prediction_weights WHERE id = 1').get() as { w_vol: number; w_rsi: number; w_sent: number } | undefined;
    if (row) {
      db.prepare('INSERT OR REPLACE INTO system_configs (id, w_vol, w_rsi, w_sent, updated_at, reason) VALUES (1, ?, ?, ?, datetime(\'now\'), ?)').run(row.w_vol, row.w_rsi, row.w_sent, 'העברה מ-prediction_weights');
    }
  }
  if (!row) return { ...DEFAULT_WEIGHTS };
  return {
    volume: row.w_vol,
    rsi: row.w_rsi,
    sentiment: row.w_sent,
  };
}

/** Manual strategy override: AI threshold % (80=standard, 90=conservative, 75=aggressive). Null = use macro-based threshold. */
export function getStrategyOverride(): number | null {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return null;
  const db = getDb();
  const row = db.prepare('SELECT ai_threshold_override FROM system_configs WHERE id = 1').get() as { ai_threshold_override?: number | null } | undefined;
  const v = row?.ai_threshold_override;
  if (v != null && Number.isFinite(v)) return Math.round(Number(v));
  return null;
}

/** Set manual strategy threshold and log reason (e.g. "עדכון ידני מהנהלת המערכת"). */
export function setStrategyOverride(thresholdPct: number, reason: string): void {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE system_configs SET ai_threshold_override = ?, updated_at = ?, reason = ? WHERE id = 1'
  ).run(thresholdPct, now, reason);
}

/** Clear manual strategy override (revert to macro-based threshold). */
export function clearStrategyOverride(): void {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE system_configs SET ai_threshold_override = NULL, updated_at = ?, reason = ? WHERE id = 1'
  ).run(now, 'חזרה לסף אוטומטי לפי מאקרו');
}

/** Last time weights were auto-tuned (from system_configs.updated_at). */
export function getLastAutoTuneAt(): string | null {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return null;
  const db = getDb();
  const row = db.prepare('SELECT updated_at FROM system_configs WHERE id = 1').get() as { updated_at: string } | undefined;
  return row?.updated_at ?? null;
}

/** Log Lessons: why the algorithm changed weights (for audit on settings). */
export function getWeightChangeLog(limit = 20): WeightChangeLogRow[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, created_at, reason_he, volume_weight, rsi_weight, sentiment_weight FROM weight_change_log ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as Array<{ id: number; created_at: string; reason_he: string; volume_weight: number; rsi_weight: number; sentiment_weight: number }>;
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    reason_he: r.reason_he,
    volume_weight: r.volume_weight,
    rsi_weight: r.rsi_weight,
    sentiment_weight: r.sentiment_weight,
  }));
}

export function setWeights(weights: PredictionWeights, reason?: string): void {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return;
  const { volume, rsi, sentiment } = weights;
  const sum = volume + rsi + sentiment;
  if (Math.abs(sum - 1) > 0.01) return;
  const db = getDb();
  const now = new Date().toISOString();
  const reasonHe = reason ?? 'עדכון משקלים על ידי המערכת';
  db.prepare(
    `UPDATE prediction_weights SET volume_weight = ?, rsi_weight = ?, sentiment_weight = ?, updated_at = ?, reason = ? WHERE id = 1`
  ).run(volume, rsi, sentiment, now, reason ?? null);
  db.prepare(
    `INSERT OR REPLACE INTO system_configs (id, w_vol, w_rsi, w_sent, updated_at, reason) VALUES (1, ?, ?, ?, ?, ?)`
  ).run(volume, rsi, sentiment, now, reason ?? null);
  db.prepare(
    `INSERT INTO weight_change_log (created_at, reason_he, volume_weight, rsi_weight, sentiment_weight) VALUES (?, ?, ?, ?, ?)`
  ).run(now, reasonHe, volume, rsi, sentiment);
}

export function appendAccuracySnapshot(successRatePct: number): void {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return;
  const w = getWeights();
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  db.prepare(
    `INSERT OR REPLACE INTO accuracy_snapshots (snapshot_date, success_rate_pct, volume_weight, rsi_weight, sentiment_weight) VALUES (?, ?, ?, ?, ?)`
  ).run(date, successRatePct, w.volume, w.rsi, w.sentiment);
}

export function getAccuracySnapshots(limit = 30): WeightSnapshot[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  const rows = db.prepare(
    'SELECT snapshot_date AS date, success_rate_pct, volume_weight AS volume_weight, rsi_weight AS rsi_weight, sentiment_weight AS sentiment_weight FROM accuracy_snapshots ORDER BY snapshot_date DESC LIMIT ?'
  ).all(limit) as Array<{ date: string; success_rate_pct: number; volume_weight: number; rsi_weight: number; sentiment_weight: number }>;
  return rows.map((r) => ({
    date: r.date,
    success_rate_pct: r.success_rate_pct,
    volume_weight: r.volume_weight,
    rsi_weight: r.rsi_weight,
    sentiment_weight: r.sentiment_weight,
  }));
}
