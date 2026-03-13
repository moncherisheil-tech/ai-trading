/**
 * Learning reports (Lessons Learned) for Retrospective Engine.
 * Hebrew summaries for Telegram and UI. No personal names — generic terms only.
 */

import path from 'path';
import { APP_CONFIG } from '@/lib/config';

export interface LearningReportRow {
  id: number;
  success_summary_he: string;
  key_lesson_he: string;
  action_taken_he: string;
  accuracy_pct: number;
  created_at: string;
}

type DatabaseCtor = new (filename: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): void;
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): LearningReportRow[];
  };
};

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS learning_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  success_summary_he TEXT NOT NULL,
  key_lesson_he TEXT NOT NULL,
  action_taken_he TEXT NOT NULL,
  accuracy_pct REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_reports_created_at ON learning_reports(created_at);
`;

let dbInstance: InstanceType<DatabaseCtor> | null = null;

function getDb(): InstanceType<DatabaseCtor> {
  if (typeof process !== 'undefined' && process.env.VERCEL) {
    throw new Error('SQLite is not available on Vercel. Use DATABASE_URL (Postgres) instead.');
  }
  if (APP_CONFIG.dbDriver !== 'sqlite') throw new Error('learning_reports requires DB_DRIVER=sqlite');
  if (!dbInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require('better-sqlite3') as DatabaseCtor;
    const filePath = path.join(process.cwd(), APP_CONFIG.sqlitePath);
    dbInstance = new BetterSqlite3(filePath);
    dbInstance.exec(TABLE_SQL);
  }
  return dbInstance;
}

export function insertLearningReport(row: {
  success_summary_he: string;
  key_lesson_he: string;
  action_taken_he: string;
  accuracy_pct: number;
}): number {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return 0;
  const db = getDb();
  const created = new Date().toISOString();
  const r = db.prepare(
    'INSERT INTO learning_reports (success_summary_he, key_lesson_he, action_taken_he, accuracy_pct, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(row.success_summary_he, row.key_lesson_he, row.action_taken_he, row.accuracy_pct, created);
  return Number((r as { lastInsertRowid: number }).lastInsertRowid);
}

export function getLatestLearningReports(limit = 10): LearningReportRow[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  return db.prepare(
    'SELECT id, success_summary_he, key_lesson_he, action_taken_he, accuracy_pct, created_at FROM learning_reports ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as LearningReportRow[];
}
