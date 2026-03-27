/**
 * Sovereign DB URL policy: production runtime requires `quantum_admin` in the URL,
 * disallows PostgreSQL user `root` unless the process is PM2-managed.
 *
 * Policy is enforced only when connections are created (see `lib/prisma.ts`, `lib/db/sql.ts`).
 * Do not import this module from `prisma.config.ts` — Prisma CLI loads config outside app runtime.
 */

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
