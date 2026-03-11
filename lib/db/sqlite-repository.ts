import type { PredictionRecord } from '@/lib/db';
import type { PredictionRepository } from '@/lib/db/repository';

type DatabaseCtor = new (filename: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    all(): PredictionRecord[];
    run(payload: string): void;
  };
};

export class SqlitePredictionRepository implements PredictionRepository {
  private readonly db: InstanceType<DatabaseCtor>;

  constructor(filePath: string) {
    // Lazy import keeps sqlite optional unless DB_DRIVER=sqlite.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require('better-sqlite3') as DatabaseCtor;
    this.db = new BetterSqlite3(filePath);
    this.db.exec('CREATE TABLE IF NOT EXISTS predictions (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);');
  }

  getAll(): PredictionRecord[] {
    const row = this.db.prepare('SELECT payload FROM predictions WHERE id = 1').all()[0] as { payload?: string } | undefined;
    if (!row?.payload) return [];
    try {
      const parsed = JSON.parse(row.payload) as unknown;
      return Array.isArray(parsed) ? (parsed as PredictionRecord[]) : [];
    } catch {
      return [];
    }
  }

  saveAll(rows: PredictionRecord[]): void {
    const payload = JSON.stringify(rows);
    this.db.prepare('INSERT INTO predictions (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(payload);
  }
}
