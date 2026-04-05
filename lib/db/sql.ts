import { Pool, type PoolClient, type QueryResult } from 'pg';
import {
  assertAuthorizedDatabaseUrl,
  normalizeDatabaseUrlEnv,
} from '@/lib/db/sovereign-db-url';

let pool: Pool | null = null;

/** Last DATABASE_URL string that passed validation (avoids re-parsing on hot paths). */
let cachedAuthorizedDatabaseUrl: string | null = null;

/**
 * Validates DATABASE_URL before any query (including `ensureTable` DDL).
 * Runs before `getPool()` so workers never open a socket until validation succeeds.
 */
function ensureDatabaseAuthorizedForQuery(): string {
  const url = normalizeDatabaseUrlEnv(process.env.DATABASE_URL);
  if (url !== cachedAuthorizedDatabaseUrl) {
    assertAuthorizedDatabaseUrl(url);
    cachedAuthorizedDatabaseUrl = url;
  }
  return url;
}

function connectionString(): string {
  return ensureDatabaseAuthorizedForQuery();
}

function isLocalHost(url: string): boolean {
  return /127\.0\.0\.1|localhost|::1/.test(url);
}

function getPool(): Pool {
  if (!pool) {
    const cs = connectionString();
    pool = new Pool({
      connectionString: cs,
      // Disable SSL for on-prem local Postgres — no TLS cert installed by default.
      ssl: isLocalHost(cs) ? false : undefined,
      // Institutional default: 50 concurrent connections.
      // Eliminates "timeout exceeded when trying to connect" under parallel job load.
      // Override via PG_POOL_MAX env var (e.g. PG_POOL_MAX=20 for limited DB plans).
      max: Number(process.env.PG_POOL_MAX ?? 50),
      // Release idle clients after 30 s to prevent zombie connections accumulating
      // during quiet market hours. Clients are re-created on the next query.
      idleTimeoutMillis: 30_000,
      // 15 s — accounts for Israel → Germany cross-border latency (was 5 s,
      // which caused premature ETIMEDOUT on the first post-idle query).
      connectionTimeoutMillis: 15_000,
      // TCP keepalives — prevents silent TCP drops by routers/firewalls during
      // quiet market hours. Mirrors the keepalive config on the Prisma pool.
      keepAlive: true,
      keepAliveInitialDelayMillis: 60_000,
    });

    pool.on('error', (err) => {
      console.error('[sql:pool] idle-client error:', err.message);
    });

    pool.on('connect', () => {
      // Visible in PM2 logs — confirms new connections are being established
      // after idle teardown (expected after quiet periods, not a leak signal).
    });

    console.log(
      `[sql:pool] Postgres pool initialized — max=${process.env.PG_POOL_MAX ?? 50}, ` +
      `idle=${30_000}ms, connect_timeout=${15_000}ms`
    );
  }
  return pool;
}

/** Ensures core DDL (settings, telegram_subscribers, etc.) once per process; avoids recursion with initDB. */
let coreSchemaInitPromise: Promise<void> | null = null;

function runCoreSchemaInitOnce(): Promise<void> {
  if (!coreSchemaInitPromise) {
    coreSchemaInitPromise = import('@/lib/db')
      .then((m) => m.initDB())
      .catch((err) => {
        coreSchemaInitPromise = null;
        console.error('[sql] Core schema initialization failed:', err);
        throw err;
      });
  }
  return coreSchemaInitPromise;
}

/**
 * Raw parameterized query without schema bootstrap — used only by `initDB` to avoid deadlocks.
 */
export function queryRaw(text: string, params: unknown[] = []): Promise<QueryResult> {
  ensureDatabaseAuthorizedForQuery();
  return getPool().query(text, params);
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
  return runCoreSchemaInitOnce().then(() => getPool().query(text, params));
}

/**
 * ACID helper for multi-statement writes (e.g. portfolio + execution log). Single `sql` inserts are already atomic.
 */
export async function withSqlTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  ensureDatabaseAuthorizedForQuery();
  await runCoreSchemaInitOnce();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
