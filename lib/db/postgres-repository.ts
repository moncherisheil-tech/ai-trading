import { neon } from '@neondatabase/serverless';
import type { PredictionRecord } from '@/lib/db';
import type { PredictionRepository } from '@/lib/db/repository';

export class PostgresPredictionRepository implements PredictionRepository {
  private readonly sql;

  constructor(connectionString: string) {
    if (!connectionString?.trim()) {
      throw new Error('Postgres connection string is missing');
    }
    this.sql = neon(connectionString);
  }

  private async ensureTable(): Promise<boolean> {
    try {
      await this.sql`
        CREATE TABLE IF NOT EXISTS prediction_records (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          status TEXT NOT NULL,
          prediction_date TIMESTAMPTZ NOT NULL,
          payload JSONB NOT NULL
        );
      `;
      await this.sql`CREATE INDEX IF NOT EXISTS idx_prediction_records_symbol ON prediction_records(symbol);`;
      await this.sql`CREATE INDEX IF NOT EXISTS idx_prediction_records_status ON prediction_records(status);`;
      await this.sql`CREATE INDEX IF NOT EXISTS idx_prediction_records_prediction_date ON prediction_records(prediction_date DESC);`;
      return true;
    } catch (err) {
      console.error('Postgres ensureTable failed:', err);
      return false;
    }
  }

  getAll(): PredictionRecord[] {
    throw new Error('Postgres repository requires async access; use getAllAsync.');
  }

  saveAll(): void {
    throw new Error('Postgres repository requires async access; use saveAllAsync.');
  }

  async getAllAsync(): Promise<PredictionRecord[]> {
    try {
      const ok = await this.ensureTable();
      if (!ok) return [];
      const rows = await this.sql`
        SELECT payload FROM prediction_records ORDER BY prediction_date DESC
      `;
      return rows.map((row: { payload?: unknown }) => row.payload as PredictionRecord);
    } catch (err) {
      console.error('Postgres getAllAsync failed:', err);
      return [];
    }
  }

  async saveAllAsync(rows: PredictionRecord[]): Promise<void> {
    try {
      const ok = await this.ensureTable();
      if (!ok) return;
      await this.sql`DELETE FROM prediction_records`;
      for (const row of rows) {
        await this.sql`
          INSERT INTO prediction_records (id, symbol, status, prediction_date, payload)
          VALUES (${row.id}, ${row.symbol}, ${row.status}, ${row.prediction_date}, ${JSON.stringify(row)})
        `;
      }
    } catch (err) {
      console.error('Postgres saveAllAsync failed:', err);
    }
  }
}