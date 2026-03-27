import 'dotenv/config';
import { Pool, type QueryResult } from 'pg';
import {
  assertAuthorizedDatabaseUrl,
  isDbConfigBuildPhaseImmune,
} from '@/lib/db/sovereign-db-url';

let pool: Pool | null = null;

function normalizeEnvValue(raw: string | undefined): string {
  const value = (raw || '').trim();
  if (!value) return '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function connectionString(): string {
  const url = normalizeEnvValue(process.env.DATABASE_URL);
  if (isDbConfigBuildPhaseImmune()) {
    if (!url) {
      return 'postgresql://quantum_admin:build@127.0.0.1:5432/_build_placeholder';
    }
    return url;
  }
  assertAuthorizedDatabaseUrl(url);
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
