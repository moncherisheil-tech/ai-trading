/**
 * Persistent storage for UI Simulation (Paper Trading) trades.
 * Uses Vercel Postgres so data persists across serverless invocations and page reloads.
 * Wallet is derived from trades: start 10_000, apply each trade in chronological order.
 */

import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface SimulationTradeRow {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  amount_usd: number;
  amount_asset: number;
  fee_usd: number;
  timestamp: number;
  date_label: string;
}

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

export async function insertSimulationTrade(row: SimulationTradeRow): Promise<void> {
  if (!usePostgres()) return;
  try {
    await sql`
      INSERT INTO simulation_trades (id, symbol, side, price, amount_usd, amount_asset, fee_usd, timestamp, date_label)
      VALUES (${row.id}, ${row.symbol}, ${row.side}, ${row.price}, ${row.amount_usd}, ${row.amount_asset}, ${row.fee_usd}, ${row.timestamp}, ${row.date_label})
      ON CONFLICT (id) DO UPDATE
        SET
          symbol = EXCLUDED.symbol,
          side = EXCLUDED.side,
          price = EXCLUDED.price,
          amount_usd = EXCLUDED.amount_usd,
          amount_asset = EXCLUDED.amount_asset,
          fee_usd = EXCLUDED.fee_usd,
          timestamp = EXCLUDED.timestamp,
          date_label = EXCLUDED.date_label
    `;
  } catch (err) {
    console.error('insertSimulationTrade failed:', err);
    throw err;
  }
}

export async function listSimulationTrades(): Promise<SimulationTradeRow[]> {
  if (!usePostgres()) return [];
  try {
    const { rows } = await sql`
      SELECT id, symbol, side, price, amount_usd, amount_asset, fee_usd, timestamp, date_label
      FROM simulation_trades
      ORDER BY timestamp DESC
    `;
    return (rows || []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      symbol: String(r.symbol),
      side: r.side as 'buy' | 'sell',
      price: Number(r.price),
      amount_usd: Number(r.amount_usd),
      amount_asset: Number(r.amount_asset),
      fee_usd: Number(r.fee_usd),
      timestamp: Number(r.timestamp),
      date_label: String(r.date_label ?? ''),
    })) as SimulationTradeRow[];
  } catch (err) {
    console.error('listSimulationTrades failed:', err);
    return [];
  }
}

export async function resetSimulationTrades(): Promise<void> {
  if (!usePostgres()) return;
  try {
    await sql`DELETE FROM simulation_trades`;
  } catch (err) {
    console.error('resetSimulationTrades failed:', err);
    throw err;
  }
}
