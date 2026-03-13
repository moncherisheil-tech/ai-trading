/**
 * SQLite schema for historical predictions (feedback loop).
 * Stores evaluated predictions for learning and accuracy metrics.
 */

import path from 'path';
import { APP_CONFIG } from '@/lib/config';

export interface HistoricalPredictionRow {
  id: number;
  prediction_id: string;
  symbol: string;
  prediction_date: string;
  predicted_direction: 'Bullish' | 'Bearish' | 'Neutral';
  entry_price: number;
  actual_price: number;
  price_diff_pct: number;
  absolute_error_pct: number;
  /** Predicted % move (for MAE). */
  target_percentage: number | null;
  /** AI confidence 0–100 for Confidence vs Reality chart. */
  probability: number | null;
  outcome_label: string;
  requires_deep_analysis: boolean;
  evaluated_at: string;
  sentiment_score: number | null;
  market_narrative: string | null;
  bottom_line_he: string | null;
  risk_level_he: string | null;
  forecast_24h_he: string | null;
}

type DatabaseCtor = new (filename: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { lastInsertRowid: number };
    all(...args: unknown[]): HistoricalPredictionRow[] | Record<string, unknown>[];
  };
};

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS historical_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  prediction_date TEXT NOT NULL,
  predicted_direction TEXT NOT NULL,
  entry_price REAL NOT NULL,
  actual_price REAL NOT NULL,
  price_diff_pct REAL NOT NULL,
  absolute_error_pct REAL NOT NULL,
  target_percentage REAL,
  outcome_label TEXT NOT NULL,
  requires_deep_analysis INTEGER NOT NULL,
  evaluated_at TEXT NOT NULL,
  sentiment_score REAL,
  market_narrative TEXT,
  bottom_line_he TEXT,
  risk_level_he TEXT,
  forecast_24h_he TEXT
);
CREATE INDEX IF NOT EXISTS idx_historical_predictions_symbol ON historical_predictions(symbol);
CREATE INDEX IF NOT EXISTS idx_historical_predictions_evaluated_at ON historical_predictions(evaluated_at);
`;
const ALTER_PROBABILITY_SQL = `ALTER TABLE historical_predictions ADD COLUMN probability REAL`;

let dbInstance: InstanceType<DatabaseCtor> | null = null;

function getDb(): InstanceType<DatabaseCtor> {
  if (typeof process !== 'undefined' && process.env.VERCEL) {
    throw new Error('SQLite is not available on Vercel. Use DATABASE_URL (Postgres) instead.');
  }
  if (APP_CONFIG.dbDriver !== 'sqlite') {
    throw new Error('historical_predictions is only available when DB_DRIVER=sqlite');
  }
  if (!dbInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require('better-sqlite3') as DatabaseCtor;
    const filePath = path.join(process.cwd(), APP_CONFIG.sqlitePath);
    dbInstance = new BetterSqlite3(filePath);
    dbInstance.exec(TABLE_SQL);
    try {
      dbInstance.exec('ALTER TABLE historical_predictions ADD COLUMN target_percentage REAL');
    } catch {
      /* column may already exist */
    }
    try {
      dbInstance.exec(ALTER_PROBABILITY_SQL);
    } catch {
      /* column may already exist */
    }
  }
  return dbInstance;
}

export interface AppendHistoricalInput {
  prediction_id: string;
  symbol: string;
  prediction_date: string;
  predicted_direction: 'Bullish' | 'Bearish' | 'Neutral';
  entry_price: number;
  actual_price: number;
  price_diff_pct: number;
  absolute_error_pct: number;
  target_percentage?: number | null;
  probability?: number | null;
  outcome_label: string;
  requires_deep_analysis: boolean;
  evaluated_at: string;
  sentiment_score?: number | null;
  market_narrative?: string | null;
  bottom_line_he?: string | null;
  risk_level_he?: string | null;
  forecast_24h_he?: string | null;
}

export function appendHistoricalPrediction(row: AppendHistoricalInput): void {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return;
  const db = getDb();
  db.prepare(
    `INSERT INTO historical_predictions (
      prediction_id, symbol, prediction_date, predicted_direction,
      entry_price, actual_price, price_diff_pct, absolute_error_pct, target_percentage, probability,
      outcome_label, requires_deep_analysis, evaluated_at,
      sentiment_score, market_narrative, bottom_line_he, risk_level_he, forecast_24h_he
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.prediction_id,
    row.symbol,
    row.prediction_date,
    row.predicted_direction,
    row.entry_price,
    row.actual_price,
    row.price_diff_pct,
    row.absolute_error_pct,
    row.target_percentage ?? null,
    row.probability ?? null,
    row.outcome_label,
    row.requires_deep_analysis ? 1 : 0,
    row.evaluated_at,
    row.sentiment_score ?? null,
    row.market_narrative ?? null,
    row.bottom_line_he ?? null,
    row.risk_level_he ?? null,
    row.forecast_24h_he ?? null
  );
}

const HIT_LABELS = ['bullish_win', 'bearish_win', 'neutral_win'];

/** For Confidence vs Reality chart: buckets of confidence (0–100) and success rate per bucket. */
export function getAccuracyByConfidenceBucket(limit = 100): Array<{ bucket: string; confidence_min: number; confidence_max: number; total: number; hits: number; success_rate_pct: number }> {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  const rows = db.prepare(
    `SELECT probability, outcome_label FROM historical_predictions WHERE probability IS NOT NULL ORDER BY evaluated_at DESC LIMIT ?`
  ).all(limit) as Array<{ probability: number; outcome_label: string }>;
  const buckets = [
    { min: 50, max: 60, label: '50–60%' },
    { min: 60, max: 70, label: '60–70%' },
    { min: 70, max: 80, label: '70–80%' },
    { min: 80, max: 90, label: '80–90%' },
    { min: 90, max: 101, label: '90–100%' },
  ];
  return buckets.map((b) => {
    const inBucket = rows.filter((r) => r.probability >= b.min && r.probability < b.max);
    const hits = inBucket.filter((r) => HIT_LABELS.includes(r.outcome_label)).length;
    return {
      bucket: b.label,
      confidence_min: b.min,
      confidence_max: b.max,
      total: inBucket.length,
      hits,
      success_rate_pct: inBucket.length > 0 ? Math.round((hits / inBucket.length) * 1000) / 10 : 0,
    };
  });
}

export function listHistoricalPredictions(limit = 100): HistoricalPredictionRow[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  return db.prepare(
    'SELECT * FROM historical_predictions ORDER BY evaluated_at DESC LIMIT ?'
  ).all(limit) as HistoricalPredictionRow[];
}

export function getHistoricalBySymbol(symbol: string, limit = 50): HistoricalPredictionRow[] {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return [];
  const db = getDb();
  return db.prepare(
    'SELECT * FROM historical_predictions WHERE symbol = ? ORDER BY evaluated_at DESC LIMIT ?'
  ).all(symbol, limit) as HistoricalPredictionRow[];
}

/** Latest prediction_id for symbol (for linking deep_analysis_logs to learning loop). */
export function getLatestPredictionIdBySymbol(symbol: string): string | null {
  if (process.env.VERCEL || APP_CONFIG.dbDriver !== 'sqlite') return null;
  const db = getDb();
  const row = db.prepare(
    'SELECT prediction_id FROM historical_predictions WHERE symbol = ? ORDER BY evaluated_at DESC LIMIT 1'
  ).all(symbol)[0] as { prediction_id: string } | undefined;
  return row?.prediction_id ?? null;
}
