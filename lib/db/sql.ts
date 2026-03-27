import 'dotenv/config';
import { Pool, type QueryResult } from 'pg';
import { assertAuthorizedDatabaseUrl } from '@/lib/db/sovereign-db-url';

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

/** Last DATABASE_URL string that passed sovereign policy (avoids re-parsing on hot paths). */
let cachedAuthorizedDatabaseUrl: string | null = null;

/**
 * Enforces sovereign DB policy before any query (including `ensureTable` DDL).
 * Runs before `getPool()` so workers never open a socket until authorization succeeds.
 */
function ensureDatabaseAuthorizedForQuery(): string {
  const url = normalizeEnvValue(process.env.DATABASE_URL);
  if (!url) {
    throw new Error('Security Breach: Unauthorized DB User Attempted');
  }
  if (url !== cachedAuthorizedDatabaseUrl) {
    assertAuthorizedDatabaseUrl(url);
    cachedAuthorizedDatabaseUrl = url;
  }
  return url;
}

function connectionString(): string {
  return ensureDatabaseAuthorizedForQuery();
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
  ensureDatabaseAuthorizedForQuery();
  let text = strings[0] ?? '';
  const params: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    params.push(values[i]);
    text += `$${params.length}` + (strings[i + 1] ?? '');
  }
  return getPool().query(text, params);
}
