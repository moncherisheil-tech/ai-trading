import type { PredictionRecord } from '@/lib/db';
import type { PredictionRepository } from '@/lib/db/repository';

type PgClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<{ payload: unknown }> }>;
  end(): Promise<void>;
};

type PgCtor = new (config: { connectionString: string }) => PgClient;

export class PostgresPredictionRepository implements PredictionRepository {
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  private async withClient<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Client } = require('pg') as { Client: PgCtor };
    const client = new Client({ connectionString: this.connectionString });
    await client.query(`
      CREATE TABLE IF NOT EXISTS prediction_records (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        status TEXT NOT NULL,
        prediction_date TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_prediction_records_symbol ON prediction_records(symbol);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_prediction_records_status ON prediction_records(status);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_prediction_records_prediction_date ON prediction_records(prediction_date DESC);');
    try {
      return await run(client);
    } finally {
      await client.end();
    }
  }

  getAll(): PredictionRecord[] {
    throw new Error('Postgres repository requires async access; use getAllAsync.');
  }

  saveAll(): void {
    throw new Error('Postgres repository requires async access; use saveAllAsync.');
  }

  async getAllAsync(): Promise<PredictionRecord[]> {
    return this.withClient(async (client) => {
      const result = await client.query('SELECT payload FROM prediction_records ORDER BY prediction_date DESC');
      return result.rows.map((row) => row.payload as PredictionRecord);
    });
  }

  async saveAllAsync(rows: PredictionRecord[]): Promise<void> {
    await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM prediction_records');
        for (const row of rows) {
          await client.query(
            'INSERT INTO prediction_records (id, symbol, status, prediction_date, payload) VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb)',
            [row.id, row.symbol, row.status, row.prediction_date, JSON.stringify(row)]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }
}
