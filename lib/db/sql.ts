import { Pool, type QueryResult } from 'pg';

let pool: Pool | null = null;

function connectionString(): string {
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
  if (!url) {
    throw new Error('DATABASE_URL or POSTGRES_URL must be set for PostgreSQL access.');
  }
  return url;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

/**
 * Tagged-template query helper, API-compatible with the former `@vercel/postgres` `sql` export.
 * Values are passed as parameterized query arguments ($1, $2, …).
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<QueryResult> {
  let text = strings[0] ?? '';
  const params: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    params.push(values[i]);
    text += `$${params.length}` + (strings[i + 1] ?? '');
  }
  return getPool().query(text, params);
}
