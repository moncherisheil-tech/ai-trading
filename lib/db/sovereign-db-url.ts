/**
 * Sovereign DB URL policy: production connections must use PostgreSQL role `quantum_admin`.
 * Role `postgres` is always rejected. Optional `INTERNAL_SECURITY_BYPASS` (UUID) relaxes
 * user checks for controlled environments while still blocking `postgres`.
 *
 * PM2-managed processes are recognized via `pm_id`, `PM2_HOME`, or `NODE_APP_INSTANCE`
 * so Ubuntu/VPS deployments under root + PM2 are not misclassified.
 *
 * Policy is enforced when connections are created (see `lib/prisma.ts`, `lib/db/sql.ts`).
 * Do not import this module from `prisma.config.ts` — Prisma CLI loads config outside app runtime.
 */

/**
 * When `process.env.INTERNAL_SECURITY_BYPASS` equals this value, non-`postgres` URLs are allowed
 * even if the DB user is not `quantum_admin`. Set the same UUID in server `.env` only where intended.
 */
export const INTERNAL_SECURITY_BYPASS_EXPECTED =
  'c9a4f2e1-8b3d-4a7c-9e1f-2d6c8b4a0e53';

function internalSecurityBypassActive(): boolean {
  const token = (process.env.INTERNAL_SECURITY_BYPASS || '').trim();
  return token === INTERNAL_SECURITY_BYPASS_EXPECTED;
}

/** True when running under PM2 or a PM2-style clustered Node app. */
export function isPm2ManagedProcess(): boolean {
  const pmId = process.env.pm_id;
  if (typeof pmId === 'string' && pmId.length > 0) return true;
  const pm2Home = process.env.PM2_HOME;
  if (typeof pm2Home === 'string' && pm2Home.length > 0) return true;
  const nodeAppInstance = process.env.NODE_APP_INSTANCE;
  if (typeof nodeAppInstance === 'string' && nodeAppInstance.length > 0) return true;
  return false;
}

/**
 * Strict runtime enforcement — call only when opening DB connections (Prisma, pg Pool).
 * @throws Error with message Security Breach when policy is violated.
 */
export function assertAuthorizedDatabaseUrl(url: string): void {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    throw new Error('Security Breach: Unauthorized DB User Attempted');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      'DATABASE_URL is invalid. Use a full PostgreSQL URL (postgres://... or postgresql://...).'
    );
  }
  const dbUser = decodeURIComponent(parsed.username || '');

  if (dbUser === 'postgres') {
    throw new Error('Security Breach: Unauthorized DB User Attempted');
  }

  const bypass = internalSecurityBypassActive();

  if (!bypass) {
    if (dbUser !== 'quantum_admin') {
      throw new Error('Security Breach: Unauthorized DB User Attempted');
    }
  }

  if (!parsed.hostname || parsed.hostname === 'base') {
    throw new Error('invalid database host');
  }
}
