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
  | {
      success: true;
      data: PredictionRecord;
      chartData: BinanceKline[];
      riskManagement?: {
        suggestedPositionSize: number;
        stopLoss: number | null;
        takeProfit: number | null;
        positionRejected: boolean;
        rationale: string;
      };
    }
  | { success: false; error: string; requestId?: string; quotaExhausted?: boolean };

export type LoginResult =
  | { success: true; redirectTo?: string }
  | { success: false; error: string };
