import fs from 'fs';
import path from 'path';
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

class FileBacktestRepository implements BacktestRepository {
  private readonly dbPath: string = BACKTEST_LOG_PATH;

  async append(entry: BacktestLogEntry): Promise<void> {
    if (process.env.NODE_ENV === 'production') return; // Vercel: no file writes
    try {
      const line = JSON.stringify(entry);
      await fs.promises.appendFile(this.dbPath, `${line}\n`, { encoding: 'utf-8' });
    } catch {
      // Read-only filesystem: skip write to avoid 500
    }
  }
}

/** Read and parse all backtest log entries from backtests.jsonl. */
export async function listBacktests(): Promise<BacktestLogEntry[]> {
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
  // For now we only implement file-based storage. This can be
  // extended later with SQLite/Postgres using APP_CONFIG.dbDriver.
  if (APP_CONFIG.dbDriver === 'sqlite' || APP_CONFIG.dbDriver === 'postgres') {
    // Still safe to use file-based logs even when main DB is SQL.
    return new FileBacktestRepository();
  }

  return new FileBacktestRepository();
}

