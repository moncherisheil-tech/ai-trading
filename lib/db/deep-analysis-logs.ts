/**
 * Deep analysis logs: persist every Deep Analysis result for audit and learning loop.
 * Optional prediction_id links to historical_predictions for long-term learning.
 */

import path from 'path';
import { APP_CONFIG } from '@/lib/config';
import type { DeepAnalysisResult } from '@/lib/deep-analysis-service';

export interface DeepAnalysisLogRow {
  id: number;
  symbol: string;
  created_at: string;
  news_sentiment: string;
  news_narrative_he: string;
  onchain_summary_he: string;
  onchain_signal: string;
  technical_score: number;
  weighted_verdict_pct: number;
  verdict_he: string;
  recommendation_he: string;
  prediction_id: string | null;
}

type DatabaseCtor = new (filename: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { lastInsertRowid: number };
    all(...args: unknown[]): DeepAnalysisLogRow[];
  };
};

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS deep_analysis_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  created_at TEXT NOT NULL,
  news_sentiment TEXT NOT NULL,
  news_narrative_he TEXT NOT NULL,
  onchain_summary_he TEXT NOT NULL,
  onchain_signal TEXT NOT NULL,
  technical_score REAL NOT NULL,
  weighted_verdict_pct REAL NOT NULL,
  verdict_he TEXT NOT NULL,
  recommendation_he TEXT NOT NULL,
  prediction_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_deep_analysis_logs_symbol ON deep_analysis_logs(symbol);
CREATE INDEX IF NOT EXISTS idx_deep_analysis_logs_created_at ON deep_analysis_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_deep_analysis_logs_prediction_id ON deep_analysis_logs(prediction_id);
`;

let dbInstance: InstanceType<DatabaseCtor> | null = null;

function getDb(): InstanceType<DatabaseCtor> {
  if (typeof process !== 'undefined' && process.env.VERCEL) {
    throw new Error('SQLite is not available on Vercel. Use DATABASE_URL (Postgres) instead.');
  }
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    throw new Error('deep_analysis_logs is only available when DB_DRIVER=sqlite');
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

export function insertDeepAnalysisLog(
  result: DeepAnalysisResult,
  predictionId?: string | null
): number {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return 0;
  const db = getDb();
  const r = db.prepare(
    `INSERT INTO deep_analysis_logs (
      symbol, created_at, news_sentiment, news_narrative_he, onchain_summary_he, onchain_signal,
      technical_score, weighted_verdict_pct, verdict_he, recommendation_he, prediction_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    result.symbol,
    result.created_at,
    result.news.sentiment,
    result.news.narrative_he,
    result.onchain.summary_he,
    result.onchain.signal,
    result.technical.score,
    result.weighted_verdict_pct,
    result.verdict_he,
    result.recommendation_he,
    predictionId ?? null
  );
  return Number((r as { lastInsertRowid: number }).lastInsertRowid);
}

export function getDeepAnalysisLogsBySymbol(symbol: string, limit = 20): DeepAnalysisLogRow[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  return db.prepare(
    'SELECT * FROM deep_analysis_logs WHERE symbol = ? ORDER BY created_at DESC LIMIT ?'
  ).all(symbol, limit) as DeepAnalysisLogRow[];
}

export function getDeepAnalysisLogsByPredictionId(predictionId: string): DeepAnalysisLogRow[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  return db.prepare(
    'SELECT * FROM deep_analysis_logs WHERE prediction_id = ? ORDER BY created_at DESC'
  ).all(predictionId) as DeepAnalysisLogRow[];
}
