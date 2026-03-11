import type { PredictionRecord } from '@/lib/db';

export interface PredictionRepository {
  getAll(): PredictionRecord[];
  saveAll(rows: PredictionRecord[]): void;
}
