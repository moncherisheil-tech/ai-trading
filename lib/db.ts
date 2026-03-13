import { neon } from '@neondatabase/serverless';

// --- 1. הגדרות טיפוסים (חובה עבור שאר האתר) ---
export interface SourceCitation {
  source_name: string;
  source_type: 'market_data' | 'sentiment' | 'historical' | 'derived';
  timestamp: string;
  evidence_snippet: string;
  relevance_score: number;
}

export interface PredictionRecord {
  id: string;
  symbol: string;
  prediction_date: string;
  predicted_direction: 'Bullish' | 'Bearish' | 'Neutral';
  probability: number;
  target_percentage: number;
  entry_price: number;
  status: string;
  /** Set after evaluation; used in UI and backtest. */
  actual_outcome?: string;
  sentiment_score?: number;
  market_narrative?: string;
  logic?: string;
  error_report?: string;
  bottom_line_he?: string;
  risk_level_he?: string;
  forecast_24h_he?: string;
  risk_status?: 'normal' | 'extreme_fear' | 'extreme_greed';
  strategic_advice?: string;
  learning_context?: string;
  sources?: SourceCitation[];
  model_name?: string;
  fallback_used?: boolean;
  latency_ms?: number;
  validation_repaired?: boolean;
}

// --- 2. מנוע Neon (lazy – לא יוצר חיבור אם חסר DATABASE_URL) ---
let _sql: ReturnType<typeof neon> | null = null;

function getSql(): ReturnType<typeof neon> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing');
  }
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

export async function query(text: string, params: any[] = []) {
  try {
    const sql = getSql();
    const result = await sql.query(text, params);
    return result;
  } catch (error) {
    console.error('Database Error:', error);
    throw error;
  }
}

export async function getPredictionRepository() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is missing');
  }
  const { PostgresPredictionRepository } = await import('./db/postgres-repository');
  return new PostgresPredictionRepository(url);
}

/**
 * אתחול בסיס הנתונים - יוצר את הטבלאות.
 * Serverless-safe: לא מפיל את ה-route אם חסר DATABASE_URL או אם יצירת הטבלאות נכשלת.
 */
export async function initDB(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is missing');
    return;
  }
  try {
    const sql = getSql();
    await sql.query(
      `CREATE TABLE IF NOT EXISTS prediction_records (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        status TEXT NOT NULL,
        prediction_date TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL
      )`,
      []
    );
    await sql.query(
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      []
    );
  } catch (err) {
    console.error('DB initialization failed:', err);
    // לא זורקים – כדי שה-API route לא יקבל 500 בגלל אתחול
  }
}

/**
 * מחזיר את כל רשומות החיזויים מהמאגר (Postgres).
 * אם חסר DATABASE_URL – מחזיר מערך ריק.
 */
export async function getDbAsync(): Promise<PredictionRecord[]> {
  if (!process.env.DATABASE_URL) {
    return [];
  }
  try {
    const repo = await getPredictionRepository();
    return await repo.getAllAsync();
  } catch (error) {
    console.error('getDbAsync failed:', error);
    return [];
  }
}

/**
 * שומר את מערך החיזויים במאגר.
 * אם חסר DATABASE_URL – לא עושה כלום.
 */
export async function saveDbAsync(rows: PredictionRecord[]): Promise<void> {
  if (!process.env.DATABASE_URL) {
    return;
  }
  try {
    const repo = await getPredictionRepository();
    await repo.saveAllAsync(rows);
  } catch (error) {
    console.error('saveDbAsync failed:', error);
  }
}

export default { getSql, query, getDbAsync, saveDbAsync, getPredictionRepository, initDB };
