/**
 * Sovereign DB URL policy: never connect as the default role `postgres`.
 * Allowed role is `quantum_admin` (parsed from DATABASE_URL).
 * In production, verification is lightweight: parsed user or `quantum_admin` as URL authority.
 * Enforced when opening DB connections (`lib/prisma.ts`, `lib/db/sql.ts`).
 * Do not import from `prisma.config.ts` — Prisma CLI loads config outside app runtime.
 */

const QUANTUM_ADMIN = 'quantum_admin';

/** Same URL string → skip re-parse (hot paths call this per query via sql.ts cache + here). */
let lastAuthorizedUrl: string | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** True when `quantum_admin` appears as the PostgreSQL URL user (not e.g. only inside a password). */
function authorityHasQuantumAdmin(trimmed: string): boolean {
  return /:\/\/quantum_admin(?=[:@])/i.test(trimmed);
}

/**
 * Strict enforcement — call only when opening DB connections (Prisma, pg Pool).
 * @throws Error when URL is missing, invalid, uses `postgres`, or identity is not `quantum_admin`.
 */
export function assertAuthorizedDatabaseUrl(url: string): void {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    throw new Error('Security Breach: Unauthorized DB User Attempted');
  }
  if (trimmed === lastAuthorizedUrl) {
    return;
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
    throw new Error(
      "Fatal Security Error: DATABASE_URL must not use the default PostgreSQL superuser role 'postgres'."
    );
  }

  if (isProduction()) {
    if (dbUser === QUANTUM_ADMIN || authorityHasQuantumAdmin(trimmed)) {
      lastAuthorizedUrl = trimmed;
      return;
    }
    throw new Error('Security Breach: Unauthorized DB User Attempted');
  }

  if (dbUser !== QUANTUM_ADMIN) {
    throw new Error('Security Breach: Unauthorized DB User Attempted');
  }

  lastAuthorizedUrl = trimmed;
}
