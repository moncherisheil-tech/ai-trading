import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import {
  assertAuthorizedDatabaseUrl,
  normalizeDatabaseUrlEnv,
} from '@/lib/db/sovereign-db-url';

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
      globalForPrisma.prismaPool = new Pool({
        connectionString: url,
        // Disable SSL for localhost — Ubuntu Postgres has no TLS by default.
        ssl: isLocalHost(url) ? false : undefined,
        // Keep the Prisma pool small; raw sql.ts has its own separate pool.
        max: Number(process.env.PRISMA_POOL_MAX ?? 5),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
    }
    const adapter = new PrismaPg(globalForPrisma.prismaPool);
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }

  return globalForPrisma.prisma;
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
