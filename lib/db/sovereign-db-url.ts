/**
 * Sovereign DB URL policy: production runtime requires `quantum_admin` in the URL,
 * disallows PostgreSQL user `root` unless the process is PM2-managed.
 *
 * Config-time paths (`getDatasourceUrlForPrismaConfig`) never throw — policy is enforced
 * only when connections are created (see `lib/prisma.ts`, `lib/db/sql.ts`).
 */

/** Placeholder URL for Prisma schema tooling (generate/validate) when DATABASE_URL is unset. */
export const PRISMA_BUILD_DUMMY_DATABASE_URL =
  'postgresql://quantum_admin:sovereign_build@127.0.0.1:5432/_prisma_schema_tooling?schema=public';

/**
 * Resolved when Prisma reads `datasource.url`. Must never throw (Next/Prisma config runs in
 * worker threads without full env). On policy failure: warn and return the URL anyway.
 */
export function getDatasourceUrlForPrismaConfig(): string {
  const url = process.env.DATABASE_URL?.trim() || '';
  if (!url) {
    return PRISMA_BUILD_DUMMY_DATABASE_URL;
  }
  try {
    assertAuthorizedDatabaseUrl(url);
  } catch (e) {
    console.warn(
      '[sovereign-db-url] Datasource URL policy check skipped at config time (enforced at DB connect):',
      e instanceof Error ? e.message : e
    );
  }
  return url;
}

/** True when running under PM2 (child processes receive pm_id). */
export function isPm2ManagedProcess(): boolean {
  return typeof process.env.pm_id === 'string' && process.env.pm_id.length > 0;
}

/**
 * Strict runtime enforcement — call only when opening DB connections (Prisma, pg Pool).
 * @throws Error with message Security Breach when policy is violated.
 */
export function assertAuthorizedDatabaseUrl(url: string): void {
  const trimmed = (url || '').trim();
  if (!trimmed || !trimmed.includes('quantum_admin')) {
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
  if (
    process.env.NODE_ENV === 'production' &&
    dbUser === 'root' &&
    !isPm2ManagedProcess()
  ) {
    throw new Error('Security Breach: Unauthorized DB User Attempted');
  }

  if (!parsed.hostname || parsed.hostname === 'base') {
    throw new Error('invalid database host');
  }
}
