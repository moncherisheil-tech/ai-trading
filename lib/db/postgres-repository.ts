import { sql } from '@/lib/db/sql';
import type { PredictionRecord } from '@/lib/db';
import type { PredictionRepository } from '@/lib/db/repository';

export class PostgresPredictionRepository implements PredictionRepository {
  getAll(): PredictionRecord[] {
    throw new Error('Postgres repository requires async access; use getAllAsync.');
  }

  saveAll(): void {
    throw new Error('Postgres repository requires async access; use saveAllAsync.');
  }

  async getAllAsync(): Promise<PredictionRecord[]> {
    try {
      const { rows } = await sql`
        SELECT payload FROM prediction_records ORDER BY prediction_date DESC
      `;
      return (rows || []).map((row: { payload?: unknown }) => row.payload as PredictionRecord);
    } catch (err) {
      console.error('Postgres getAllAsync failed:', err);
      return [];
    }
  }

  async saveAllAsync(rows: PredictionRecord[]): Promise<void> {
    try {
      await sql`DELETE FROM prediction_records`;
      for (const row of rows) {
        await sql`
          INSERT INTO prediction_records (id, symbol, status, prediction_date, payload)
          VALUES (${row.id}, ${row.symbol}, ${row.status}, ${row.prediction_date}, ${JSON.stringify(row)})
          ON CONFLICT (id) DO UPDATE
          SET
            status = EXCLUDED.status,
            payload = EXCLUDED.payload,
            prediction_date = EXCLUDED.prediction_date
        `;
      }
    } catch (err) {
      console.error('Postgres saveAllAsync failed:', err);
    }
  }
}
