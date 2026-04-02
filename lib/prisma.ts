import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import {
  assertAuthorizedDatabaseUrl,
  normalizeDatabaseUrlEnv,
} from '@/lib/db/sovereign-db-url';

/** Extracts `host:port` from a postgres connection string for log labels. */
function extractDbHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}`;
  } catch {
    return 'unknown-host';
  }
}

// ─── GLOBAL SINGLETON ────────────────────────────────────────────────────────
// One PrismaClient per process (Next.js + Worker). In development, the module
// cache is evicted on every hot-reload, so we pin the instance to `globalThis`
// to survive those evictions without opening a fresh connection pool each time.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPool: Pool | undefined;
};

/**
 * Returns true when the URL targets a local machine — SSL not needed and would
 * cause "self-signed certificate" errors against a plain Ubuntu Postgres install.
 */
function isLocalHost(url: string): boolean {
  return /127\.0\.0\.1|localhost|::1/.test(url);
}

/**
 * Returns true when the URL explicitly disables SSL via `sslmode=disable`.
 * Used to avoid TLS negotiation against bare-metal Postgres servers (e.g.
 * plain Ubuntu installs) that have no certificate configured.
 */
function isSslDisabled(url: string): boolean {
  return /sslmode=disable/i.test(url);
}

/**
 * Appends `sslmode=verify-full` to the connection URL for remote production
 * connections, silencing pg's "no SSL" security warning.
 * No-op when already on localhost or when sslmode is already specified.
 */
function applyProductionSsl(url: string): string {
  if (isLocalHost(url)) return url;
  if (process.env.NODE_ENV !== 'production') return url;
  if (/sslmode=/i.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}sslmode=verify-full`;
}

/**
 * Classifies a pg/Prisma connection error into a human-readable category
 * so we can distinguish network timeouts from authentication failures at a glance.
 */
function classifyDbError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'UNKNOWN';
  const e = err as Record<string, unknown>;
  const code = String(e['code'] ?? '');
  const msg  = String(e['message'] ?? '').toLowerCase();

  if (code === '28P01' || code === '28000' || msg.includes('password') || msg.includes('authentication'))
    return 'AUTH_FAILURE';
  if (code === 'ECONNREFUSED')
    return 'NETWORK_REFUSED — port 5432 not reachable (check UFW / listen_addresses)';
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || msg.includes('timeout') || msg.includes('terminated'))
    return 'NETWORK_TIMEOUT — cross-border latency or server dropped idle connection';
  if (code === '3D000')
    return 'BAD_DATABASE — database name does not exist on the server';
  if (code === '53300')
    return 'TOO_MANY_CONNECTIONS — pg max_connections exhausted';
  return `PG_ERROR(${code})`;
}

/**
 * Prisma ORM 7 requires a driver adapter.
 *
 * We pass a `pg.Pool` (instead of a raw URL string) so we can:
 *   - Disable SSL for on-prem local Postgres (no TLS overhead / cert errors).
 *   - Cap `max` connections to 5 — prevents exhausting the local Postgres
 *     `max_connections` limit when Next.js + Worker both hold open pools.
 *
 * Returns null when DATABASE_URL is unset so build-time imports stay safe.
 * Sovereign DB policy (postgres:// protocol enforcement) is checked before
 * any pool or PrismaClient is constructed.
 */
export function getPrisma(): PrismaClient | null {
  const url = normalizeDatabaseUrlEnv(process.env.DATABASE_URL);
  if (!url) return null;
  assertAuthorizedDatabaseUrl(url);

  if (!globalForPrisma.prisma) {
    // Reuse the pool if it was already created (e.g. hot-reload edge case).
    if (!globalForPrisma.prismaPool) {
      const poolUrl = applyProductionSsl(url);
      const dbHost = extractDbHost(url);
      const pool = new Pool({
        connectionString: poolUrl,
        // Disable SSL for localhost or when sslmode=disable is explicit in the URL
        // (covers bare-metal remote servers without a TLS certificate).
        ssl: isLocalHost(url) || isSslDisabled(url) ? false : undefined,
        // Keep the Prisma pool small; raw sql.ts has its own separate pool.
        max: Number(process.env.PRISMA_POOL_MAX ?? 5),
        idleTimeoutMillis: 30_000,
        // 30 s — accounts for Israel → Germany cross-border latency.
        connectionTimeoutMillis: 30_000,
        // TCP keepalives prevent silent bridge drops during quiet market hours.
        // First probe fires after 60 s idle; retried every 10 s up to 5 times.
        keepAlive: true,
        keepAliveInitialDelayMillis: 60_000,
      });

      // Surface detailed diagnostics so we can tell AUTH failures from NETWORK
      // timeouts without digging through raw pg error objects.
      pool.on('error', (err) => {
        const category = classifyDbError(err);
        const e = err as Record<string, unknown>;
        console.error(
          `[prisma:pool] idle-client error  category=${category}  code=${e['code'] ?? 'n/a'}  host=${dbHost}\n  ${err.message}`
        );
      });

      pool.on('connect', () => {
        console.log(`[prisma:pool] new physical connection established to ${dbHost}`);
      });

      globalForPrisma.prismaPool = pool;
    }
    const adapter = new PrismaPg(globalForPrisma.prismaPool);
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }

  return globalForPrisma.prisma;
}

/**
 * Wraps any Prisma call and re-throws with a categorised diagnostic message.
 * Use in API routes where you want a clean server log entry:
 *
 *   const result = await withDbDiagnostics(() => prisma.signal.create({ data }));
 */
export async function withDbDiagnostics<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const category = classifyDbError(err);
    const e = (err ?? {}) as Record<string, unknown>;
    const dbHost = extractDbHost(normalizeDatabaseUrlEnv(process.env.DATABASE_URL));
    console.error(
      `[prisma] query failed  category=${category}  code=${e['code'] ?? 'n/a'}  host=${dbHost}\n`,
      err
    );
    throw err;
  }
}

/**
 * Named `prisma` constant for direct imports:
 *   import { prisma } from '@/lib/prisma';
 *
 * Uses a Proxy so the export is safe at build time (no DATABASE_URL required
 * during `next build`). Every property access is forwarded to the singleton
 * returned by getPrisma() at call-time, not at module-load time.
 *
 * Throws a clear diagnostic message if DATABASE_URL is absent at runtime
 * and DB-touching code is inadvertently called.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, prop: string | symbol) {
    const client = getPrisma();
    if (!client) {
      throw new Error(
        `[prisma] DATABASE_URL is not set — cannot access prisma.${String(prop)}. ` +
        'Ensure DATABASE_URL is defined in your environment before any DB calls.'
      );
    }
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
