import fs from 'fs';
import path from 'path';
import { sql } from '@/lib/db/sql';
import { areTablesReady } from '@/lib/db/init-guard';
import { APP_CONFIG } from '@/lib/config';

export interface BacktestLogEntry {
  prediction_id: string;
  symbol: string;
  prediction_date: string;
  predicted_direction: 'Bullish' | 'Bearish' | 'Neutral';
  entry_price: number;
  current_price: number;
  price_diff_pct: number;
  absolute_error_pct: number;
  outcome_label: string;
  requires_deep_analysis: boolean;
  evaluated_at: string;
  sentiment_score?: number;
  market_narrative?: string;
}

export interface BacktestRepository {
  append(entry: BacktestLogEntry): Promise<void>;
}

const BACKTEST_LOG_PATH = path.join(process.cwd(), 'backtests.jsonl');

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

async function ensureBacktestTable(): Promise<boolean> {
  if (!usePostgres()) return false;
  // Short-circuit: Orchestrator already booted all tables sequentially.
  if (areTablesReady()) return true;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS backtest_logs (
        id SERIAL PRIMARY KEY,
        prediction_id VARCHAR(255) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        prediction_date VARCHAR(32) NOT NULL,
        predicted_direction VARCHAR(16) NOT NULL,
        entry_price DOUBLE PRECISION NOT NULL,
        current_price DOUBLE PRECISION NOT NULL,
        price_diff_pct DOUBLE PRECISION NOT NULL,
        absolute_error_pct DOUBLE PRECISION NOT NULL,
        outcome_label VARCHAR(64) NOT NULL,
        requires_deep_analysis BOOLEAN NOT NULL,
        evaluated_at TIMESTAMPTZ NOT NULL,
        sentiment_score DOUBLE PRECISION,
        market_narrative TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_backtest_logs_evaluated_at ON backtest_logs(evaluated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_backtest_logs_symbol ON backtest_logs(symbol)`;
    return true;
  } catch (err) {
    console.error('backtest_logs ensureTable failed:', err);
    return false;
  }
}

class PostgresBacktestRepository implements BacktestRepository {
  async append(entry: BacktestLogEntry): Promise<void> {
    try {
      const ok = await ensureBacktestTable();
      if (!ok) return;
      await sql`
        INSERT INTO backtest_logs (prediction_id, symbol, prediction_date, predicted_direction, entry_price, current_price, price_diff_pct, absolute_error_pct, outcome_label, requires_deep_analysis, evaluated_at, sentiment_score, market_narrative)
        VALUES (${entry.prediction_id}, ${entry.symbol}, ${entry.prediction_date}, ${entry.predicted_direction}, ${entry.entry_price}, ${entry.current_price}, ${entry.price_diff_pct}, ${entry.absolute_error_pct}, ${entry.outcome_label}, ${entry.requires_deep_analysis}, ${entry.evaluated_at}, ${entry.sentiment_score ?? null}, ${entry.market_narrative ?? null})
      `;
    } catch (err) {
      console.error('PostgresBacktestRepository.append failed:', err);
    }
  }
}

class FileBacktestRepository implements BacktestRepository {
  private readonly dbPath: string = BACKTEST_LOG_PATH;

  async append(entry: BacktestLogEntry): Promise<void> {
    if (process.env.NODE_ENV === 'production') return;
    try {
      const line = JSON.stringify(entry);
      await fs.promises.appendFile(this.dbPath, `${line}\n`, { encoding: 'utf-8' });
    } catch {
      // Read-only filesystem: skip write
    }
  }
}

/** Read backtest log entries within a date range (evaluated_at). Inclusive of from/to. */
export async function listBacktestsInRange(fromDate: string, toDate: string): Promise<BacktestLogEntry[]> {
  if (usePostgres()) {
    try {
      const ok = await ensureBacktestTable();
      if (!ok) return [];
      const from = new Date(fromDate);
      const to = new Date(toDate);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
      const { rows } = await sql`
        SELECT prediction_id, symbol, prediction_date, predicted_direction, entry_price, current_price, price_diff_pct, absolute_error_pct, outcome_label, requires_deep_analysis, evaluated_at::text, sentiment_score, market_narrative
        FROM backtest_logs
        WHERE evaluated_at >= ${from.toISOString()} AND evaluated_at <= ${to.toISOString()}
        ORDER BY evaluated_at ASC
      `;
      return (rows || []).map((r: Record<string, unknown>) => ({
        prediction_id: String(r.prediction_id),
        symbol: String(r.symbol),
        prediction_date: String(r.prediction_date),
        predicted_direction: r.predicted_direction as BacktestLogEntry['predicted_direction'],
        entry_price: Number(r.entry_price),
        current_price: Number(r.current_price),
        price_diff_pct: Number(r.price_diff_pct),
        absolute_error_pct: Number(r.absolute_error_pct),
        outcome_label: String(r.outcome_label),
        requires_deep_analysis: Boolean(r.requires_deep_analysis),
        evaluated_at: String(r.evaluated_at),
        sentiment_score: r.sentiment_score != null ? Number(r.sentiment_score) : undefined,
        market_narrative: r.market_narrative != null ? String(r.market_narrative) : undefined,
      }));
    } catch (err) {
      console.error('listBacktestsInRange (Postgres) failed:', err);
      return [];
    }
  }
  const all = await listBacktests();
  const fromTs = new Date(fromDate).getTime();
  const toTs = new Date(toDate).getTime();
  if (Number.isNaN(fromTs) || Number.isNaN(toTs)) return [];
  return all.filter((e) => {
    const t = new Date(e.evaluated_at).getTime();
    return t >= fromTs && t <= toTs;
  });
}

/**
 * Delete all rows from backtest_logs (zero-state for production launch).
 * Removes Mock/Test backtest entries. Does not touch AppSettings/settings table.
 */
export async function deleteAllBacktestLogs(): Promise<{ deleted: number }> {
  if (!usePostgres()) return { deleted: 0 };
  try {
    const ok = await ensureBacktestTable();
    if (!ok) return { deleted: 0 };
    const { rowCount } = await sql`DELETE FROM backtest_logs`;
    return { deleted: rowCount ?? 0 };
  } catch (err) {
    console.error('deleteAllBacktestLogs failed:', err);
    return { deleted: 0 };
  }
}

/** Read all backtest log entries: from Postgres when available, else from file. */
export async function listBacktests(): Promise<BacktestLogEntry[]> {
  if (usePostgres()) {
    try {
      const ok = await ensureBacktestTable();
      if (!ok) return [];
      const { rows } = await sql`
        SELECT prediction_id, symbol, prediction_date, predicted_direction, entry_price, current_price, price_diff_pct, absolute_error_pct, outcome_label, requires_deep_analysis, evaluated_at::text, sentiment_score, market_narrative
        FROM backtest_logs ORDER BY evaluated_at DESC
      `;
      return (rows || []).map((r: Record<string, unknown>) => ({
        prediction_id: String(r.prediction_id),
        symbol: String(r.symbol),
        prediction_date: String(r.prediction_date),
        predicted_direction: r.predicted_direction as BacktestLogEntry['predicted_direction'],
        entry_price: Number(r.entry_price),
        current_price: Number(r.current_price),
        price_diff_pct: Number(r.price_diff_pct),
        absolute_error_pct: Number(r.absolute_error_pct),
        outcome_label: String(r.outcome_label),
        requires_deep_analysis: Boolean(r.requires_deep_analysis),
        evaluated_at: String(r.evaluated_at),
        sentiment_score: r.sentiment_score != null ? Number(r.sentiment_score) : undefined,
        market_narrative: r.market_narrative != null ? String(r.market_narrative) : undefined,
      }));
    } catch (err) {
      console.error('listBacktests (Postgres) failed:', err);
      return [];
    }
  }
  try {
    const raw = await fs.promises.readFile(BACKTEST_LOG_PATH, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const entries: BacktestLogEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as BacktestLogEntry;
        if (parsed && typeof parsed.evaluated_at === 'string' && typeof parsed.absolute_error_pct === 'number') {
          entries.push(parsed);
        }
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export async function getBacktestRepository(): Promise<BacktestRepository> {
  if (usePostgres()) {
    return new PostgresBacktestRepository();
  }
  return new FileBacktestRepository();
}
