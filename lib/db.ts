import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

// --- 1. הגדרות טיפוסים (חובה עבור שאר האתר) ---
export interface SourceCitation {
  source_name: string;
  source_type: string;
  timestamp?: string | null;
  evidence_snippet: string;
  relevance_score?: number;
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
  /** Elite Terminal v1.3: number of timeframes (1H, 4H, 1D) confirming trend; Elite Gem requires >= 2. */
  trend_confirmed_timeframes?: number;
  /** High Volume Nodes (HVN) — dynamic support/resistance levels from volume profile. */
  hvn_levels?: number[];
  /** Pattern warnings from Agent Reflex (Success/Failure Feedback). */
  pattern_warnings?: string[];
  /** ATR-based suggested stop-loss (Elite Terminal v1.3). */
  suggested_sl?: number;
  /** ATR-based suggested take-profit (1.6 R/R). */
  suggested_tp?: number;
  /** Risk-manager suggested position size in USD. */
  suggested_position_size_usd?: number;
  /** Risk-manager confidence-adjusted risk fraction (e.g. 0.02). */
  suggested_risk_fraction?: number;
  /** Gemini tactical opinion based on ATR levels and HVN. */
  tactical_opinion_he?: string;
  /** MoE + Debate Room: Technician expert score (0–100). */
  tech_score?: number;
  /** MoE + Debate Room: Risk Manager expert score (0–100). */
  risk_score?: number;
  /** MoE + Debate Room: Market Psychologist expert score (0–100). */
  psych_score?: number;
  /** MoE + Debate Room: Macro & Order Book expert score (0–100, Groq). */
  macro_score?: number;
  /** MoE + Debate Room: Macro & Order Book expert logic in Hebrew. */
  macro_logic?: string;
  /** MoE + Debate Room: On-Chain Sleuth expert score (0–100). */
  onchain_score?: number;
  /** MoE + Debate Room: On-Chain Sleuth expert logic in Hebrew. */
  onchain_logic?: string;
  /** MoE + Debate Room: Deep Memory (Vector) expert score (0–100). */
  deep_memory_score?: number;
  /** MoE + Debate Room: Deep Memory (Vector) expert logic in Hebrew. */
  deep_memory_logic?: string;
  /** MoE + Debate Room: Judge consensus insight in Hebrew (Board Decision). */
  master_insight_he?: string;
  /** MoE + Debate Room: Reasoning path from Judge. */
  reasoning_path?: string;
  /** MoE: Final Gem Score (0–100) = 1/6 per expert (6-Agent Board); used for consensus_approved. */
  final_confidence?: number;
}

function hasPostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

export async function getPredictionRepository() {
  if (!hasPostgres()) {
    throw new Error('Postgres is not configured (DATABASE_URL or POSTGRES_URL).');
  }
  const { PostgresPredictionRepository } = await import('./db/postgres-repository');
  return new PostgresPredictionRepository();
}

/**
 * אתחול בסיס הנתונים - יוצר את טבלת prediction_records ב־PostgreSQL.
 * Serverless-safe: לא מפיל את ה-route אם חסר postgresUrl או אם יצירת הטבלאות נכשלת.
 */
export async function initDB(): Promise<void> {
  if (!hasPostgres()) {
    console.error('Postgres URL missing; skipping initDB.');
    return;
  }
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS prediction_records (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        status TEXT NOT NULL,
        prediction_date TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_prediction_records_symbol ON prediction_records(symbol)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_prediction_records_status ON prediction_records(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_prediction_records_prediction_date ON prediction_records(prediction_date DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS telegram_subscribers (
        id SERIAL PRIMARY KEY,
        chat_id TEXT NOT NULL UNIQUE,
        username TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        role TEXT NOT NULL DEFAULT 'subscriber',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_telegram_subscribers_is_active ON telegram_subscribers(is_active)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_telegram_subscribers_chat_id ON telegram_subscribers(chat_id)`;
  } catch (err) {
    console.error('DB initialization failed:', err);
  }
}

/**
 * מחזיר את כל רשומות החיזויים מהמאגר (PostgreSQL).
 * אם חסר postgresUrl – מחזיר מערך ריק.
 */
export async function getDbAsync(): Promise<PredictionRecord[]> {
  if (!hasPostgres()) {
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
 * אם חסר postgresUrl – לא עושה כלום.
 */
export async function saveDbAsync(rows: PredictionRecord[]): Promise<void> {
  if (!hasPostgres()) {
    return;
  }
  try {
    const repo = await getPredictionRepository();
    await repo.saveAllAsync(rows);
  } catch (error) {
    console.error('saveDbAsync failed:', error);
  }
}

const dbApi = { getDbAsync, saveDbAsync, getPredictionRepository, initDB };

export default dbApi;
