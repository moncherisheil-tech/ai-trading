import type { PredictionRecord } from '@/lib/db';

/** Used by SimulationResult for chart data. */
export interface BinanceKline {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SimulationResult =
  | { success: true; data: PredictionRecord; chartData: BinanceKline[] }
  | { success: false; error: string; requestId?: string };

export type LoginResult =
  | { success: true; redirectTo?: string }
  | { success: false; error: string };
