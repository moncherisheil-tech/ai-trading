/**
 * Dynamic weights for P_success formula (Volume, RSI, Sentiment).
 * Stored in Vercel Postgres; weight_change_log records why weights changed (Log Lessons).
 */

import { sql } from '@/lib/db/sql';
import { areTablesReady } from '@/lib/db/init-guard';
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

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

async function ensureTables(): Promise<boolean> {
  if (!usePostgres()) return false;
  // Short-circuit: Orchestrator already booted all tables sequentially.
  if (areTablesReady()) return true;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS prediction_weights (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        volume_weight NUMERIC(10,6) NOT NULL DEFAULT 0.4,
        rsi_weight NUMERIC(10,6) NOT NULL DEFAULT 0.3,
        sentiment_weight NUMERIC(10,6) NOT NULL DEFAULT 0.3,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason TEXT
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS system_configs (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        w_vol NUMERIC(10,6) NOT NULL DEFAULT 0.4,
        w_rsi NUMERIC(10,6) NOT NULL DEFAULT 0.3,
        w_sent NUMERIC(10,6) NOT NULL DEFAULT 0.3,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason TEXT,
        ai_threshold_override INTEGER
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS weight_change_log (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason_he TEXT NOT NULL,
        volume_weight NUMERIC(10,6) NOT NULL,
        rsi_weight NUMERIC(10,6) NOT NULL,
        sentiment_weight NUMERIC(10,6) NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_weight_change_log_created_at ON weight_change_log(created_at)`;
    await sql`
      CREATE TABLE IF NOT EXISTS accuracy_snapshots (
        id SERIAL PRIMARY KEY,
        snapshot_date VARCHAR(10) NOT NULL UNIQUE,
        success_rate_pct NUMERIC(10,4) NOT NULL,
        volume_weight NUMERIC(10,6) NOT NULL,
        rsi_weight NUMERIC(10,6) NOT NULL,
        sentiment_weight NUMERIC(10,6) NOT NULL
      )
    `;
    await sql`
      INSERT INTO prediction_weights (id, volume_weight, rsi_weight, sentiment_weight, updated_at, reason)
      VALUES (1, 0.4, 0.3, 0.3, NOW(), 'Initial default')
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO system_configs (id, w_vol, w_rsi, w_sent, updated_at, reason)
      VALUES (1, 0.4, 0.3, 0.3, NOW(), 'ערכי ברירת מחדל')
      ON CONFLICT (id) DO NOTHING
    `;
    return true;
  } catch (err) {
    console.error('prediction_weights ensureTables failed:', err);
    return false;
  }
}

/** Add ai_threshold_override to system_configs if missing (one-time migration). */
async function ensureSystemConfigsColumns(): Promise<void> {
  try {
    await sql`
      ALTER TABLE system_configs ADD COLUMN IF NOT EXISTS ai_threshold_override INTEGER
    `;
  } catch {
    // column may already exist (Postgres 9.5+ has IF NOT EXISTS for ADD COLUMN in some versions; otherwise ignore)
  }
}

export async function getWeights(): Promise<PredictionWeights> {
  if (!usePostgres()) return { ...DEFAULT_WEIGHTS };
  try {
    const ok = await ensureTables();
    if (!ok) return { ...DEFAULT_WEIGHTS };
    await ensureSystemConfigsColumns();
    let { rows } = await sql`SELECT w_vol, w_rsi, w_sent FROM system_configs WHERE id = 1`;
    if (!rows?.length) {
      const r = await sql`SELECT volume_weight AS w_vol, rsi_weight AS w_rsi, sentiment_weight AS w_sent FROM prediction_weights WHERE id = 1`;
      rows = r.rows;
      if (rows?.length) {
        const row = rows[0] as Record<string, number>;
        await sql`
          INSERT INTO system_configs (id, w_vol, w_rsi, w_sent, updated_at, reason)
          VALUES (1, ${row.w_vol}, ${row.w_rsi}, ${row.w_sent}, NOW(), 'העברה מ-prediction_weights')
          ON CONFLICT (id) DO UPDATE SET w_vol = EXCLUDED.w_vol, w_rsi = EXCLUDED.w_rsi, w_sent = EXCLUDED.w_sent, updated_at = NOW(), reason = EXCLUDED.reason
        `;
      }
    }
    if (!rows?.length) return { ...DEFAULT_WEIGHTS };
    const row = rows[0] as Record<string, number>;
    return { volume: Number(row.w_vol), rsi: Number(row.w_rsi), sentiment: Number(row.w_sent) };
  } catch (err) {
    console.error('getWeights failed:', err);
    return { ...DEFAULT_WEIGHTS };
  }
}

export async function getStrategyOverride(): Promise<number | null> {
  if (!usePostgres()) return null;
  try {
    await ensureTables();
    await ensureSystemConfigsColumns();
    const { rows } = await sql`SELECT ai_threshold_override FROM system_configs WHERE id = 1`;
    const v = (rows?.[0] as { ai_threshold_override?: number | null })?.ai_threshold_override;
    if (v != null && Number.isFinite(v)) return Math.round(Number(v));
    return null;
  } catch {
    return null;
  }
}

export async function setStrategyOverride(thresholdPct: number, reason: string): Promise<void> {
  if (!usePostgres()) return;
  try {
    await ensureTables();
    await ensureSystemConfigsColumns();
    await sql`UPDATE system_configs SET ai_threshold_override = ${thresholdPct}, updated_at = NOW(), reason = ${reason} WHERE id = 1`;
  } catch (err) {
    console.error('setStrategyOverride failed:', err);
  }
}

export async function clearStrategyOverride(): Promise<void> {
  if (!usePostgres()) return;
  try {
    await ensureTables();
    await sql`UPDATE system_configs SET ai_threshold_override = NULL, updated_at = NOW(), reason = 'חזרה לסף אוטומטי לפי מאקרו' WHERE id = 1`;
  } catch (err) {
    console.error('clearStrategyOverride failed:', err);
  }
}

export async function getLastAutoTuneAt(): Promise<string | null> {
  if (!usePostgres()) return null;
  try {
    await ensureTables();
    const { rows } = await sql`SELECT updated_at FROM system_configs WHERE id = 1`;
    const r = rows?.[0] as { updated_at?: string } | undefined;
    return r?.updated_at ?? null;
  } catch {
    return null;
  }
}

export async function getWeightChangeLog(limit = 20): Promise<WeightChangeLogRow[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTables();
    if (!ok) return [];
    const { rows } = await sql`
      SELECT id, created_at::text, reason_he, volume_weight::float, rsi_weight::float, sentiment_weight::float
      FROM weight_change_log ORDER BY created_at DESC LIMIT ${limit}
    `;
    return (rows || []).map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      created_at: String(r.created_at),
      reason_he: String(r.reason_he),
      volume_weight: Number(r.volume_weight),
      rsi_weight: Number(r.rsi_weight),
      sentiment_weight: Number(r.sentiment_weight),
    }));
  } catch (err) {
    console.error('getWeightChangeLog failed:', err);
    return [];
  }
}

export async function setWeights(weights: PredictionWeights, reason?: string): Promise<void> {
  if (!usePostgres()) return;
  const { volume, rsi, sentiment } = weights;
  if (Math.abs(volume + rsi + sentiment - 1) > 0.01) return;
  try {
    const ok = await ensureTables();
    if (!ok) return;
    const reasonHe = reason ?? 'עדכון משקלים על ידי המערכת';
    await sql`
      UPDATE prediction_weights SET volume_weight = ${volume}, rsi_weight = ${rsi}, sentiment_weight = ${sentiment}, updated_at = NOW(), reason = ${reason ?? null} WHERE id = 1
    `;
    await sql`
      INSERT INTO system_configs (id, w_vol, w_rsi, w_sent, updated_at, reason)
      VALUES (1, ${volume}, ${rsi}, ${sentiment}, NOW(), ${reason ?? null})
      ON CONFLICT (id) DO UPDATE SET w_vol = EXCLUDED.w_vol, w_rsi = EXCLUDED.w_rsi, w_sent = EXCLUDED.w_sent, updated_at = EXCLUDED.updated_at, reason = EXCLUDED.reason
    `;
    await sql`
      INSERT INTO weight_change_log (created_at, reason_he, volume_weight, rsi_weight, sentiment_weight)
      VALUES (NOW(), ${reasonHe}, ${volume}, ${rsi}, ${sentiment})
    `;
  } catch (err) {
    console.error('setWeights failed:', err);
  }
}

export async function appendAccuracySnapshot(successRatePct: number): Promise<void> {
  if (!usePostgres()) return;
  try {
    const w = await getWeights();
    const ok = await ensureTables();
    if (!ok) return;
    const date = new Date().toISOString().slice(0, 10);
    await sql`
      INSERT INTO accuracy_snapshots (snapshot_date, success_rate_pct, volume_weight, rsi_weight, sentiment_weight)
      VALUES (${date}, ${successRatePct}, ${w.volume}, ${w.rsi}, ${w.sentiment})
      ON CONFLICT (snapshot_date) DO UPDATE SET success_rate_pct = EXCLUDED.success_rate_pct, volume_weight = EXCLUDED.volume_weight, rsi_weight = EXCLUDED.rsi_weight, sentiment_weight = EXCLUDED.sentiment_weight
    `;
  } catch (err) {
    console.error('appendAccuracySnapshot failed:', err);
  }
}

export async function getAccuracySnapshots(limit = 30): Promise<WeightSnapshot[]> {
  if (!usePostgres()) return [];
  try {
    const ok = await ensureTables();
    if (!ok) return [];
    const { rows } = await sql`
      SELECT snapshot_date AS date, success_rate_pct::float, volume_weight::float, rsi_weight::float, sentiment_weight::float
      FROM accuracy_snapshots ORDER BY snapshot_date DESC LIMIT ${limit}
    `;
    return (rows || []).map((r: Record<string, unknown>) => ({
      date: String(r.date),
      success_rate_pct: Number(r.success_rate_pct),
      volume_weight: Number(r.volume_weight),
      rsi_weight: Number(r.rsi_weight),
      sentiment_weight: Number(r.sentiment_weight),
    }));
  } catch (err) {
    console.error('getAccuracySnapshots failed:', err);
    return [];
  }
}
