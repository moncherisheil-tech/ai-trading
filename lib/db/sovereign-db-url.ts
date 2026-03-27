/**
 * Sovereign DB URL policy: never connect as the default role `postgres`.
 * In production, `quantum_admin` is accepted automatically when present in the URL authority.
 * Connection strings are parsed with `URL` + `decodeURIComponent`; last successful URL is cached.
 * Enforced when opening DB connections (`lib/prisma.ts`, `lib/db/sql.ts`).
 * Do not import from `prisma.config.ts` — Prisma CLI loads config outside app runtime.
 */

const QUANTUM_ADMIN = 'quantum_admin';

/** Same URL string → skip re-parse (hot paths: `lib/db/sql.ts` + this module). */
let lastAuthorizedUrl: string | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Strip optional wrapping quotes (matches `lib/db/sql.ts` / `lib/config.ts`). */
export function normalizeDatabaseUrlEnv(raw: string | undefined): string {
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

/** True when `quantum_admin` appears as the PostgreSQL URL user (not only inside a password). */
function authorityHasQuantumAdmin(trimmed: string): boolean {
  return /:\/\/quantum_admin(?=[:@])/i.test(trimmed);
}

export type ParsedDatabaseUrlIdentity = {
  username: string | null;
  parseError: boolean;
};

/** Safe parse for audits (never throws). */
export function parseDatabaseUrlIdentity(url: string): ParsedDatabaseUrlIdentity {
  const trimmed = normalizeDatabaseUrlEnv(url);
  if (!trimmed) return { username: null, parseError: false };
  try {
    const parsed = new URL(trimmed);
    const u = decodeURIComponent(parsed.username || '');
    return { username: u || null, parseError: false };
  } catch {
    return { username: null, parseError: true };
  }
}

/** Human-readable remediation for operators (startup audit / logs). */
export function formatDatabaseUrlRemediation(reason: 'postgres' | 'not_quantum_admin' | 'invalid' | 'missing'): string {
  const lines = [
    '[DATABASE_URL] Production requires a PostgreSQL URL with user "quantum_admin" (never the default "postgres").',
    '',
    'Fix your server .env (or PM2 env):',
    '  DATABASE_URL=postgresql://quantum_admin:<PASSWORD>@<HOST>:5432/<DB>?schema=public',
    '',
    'Then: save the file, restart the app (e.g. pm2 restart all).',
  ];
  if (reason === 'postgres') {
    lines.splice(
      1,
      0,
      'Detected: username is "postgres" — this is blocked for security.',
      'Create role quantum_admin in Postgres, grant privileges, and point DATABASE_URL at that user.'
    );
  } else if (reason === 'not_quantum_admin') {
    lines.splice(1, 0, 'Detected: DATABASE_URL is set but the URL user is not quantum_admin.');
  } else if (reason === 'invalid') {
    lines.splice(1, 0, 'Detected: DATABASE_URL is not a valid postgres:// or postgresql:// URL.');
  } else {
    lines.splice(1, 0, 'DATABASE_URL is empty. Set it if you need persistence, cron DB routes, or the Telegram terminal.');
  }
  return lines.join('\n');
}

/**
 * Fail fast in production with operator-friendly instructions (before generic "Security Breach" at first query).
 */
export function runProductionDatabaseUrlGate(): void {
  if (!isProduction()) return;
  const trimmed = normalizeDatabaseUrlEnv(process.env.DATABASE_URL);
  if (!trimmed) {
    console.warn(formatDatabaseUrlRemediation('missing'));
    return;
  }
  const { username, parseError } = parseDatabaseUrlIdentity(trimmed);
  if (parseError) {
    console.error(formatDatabaseUrlRemediation('invalid'));
    process.exit(1);
  }
  if (username === 'postgres') {
    console.error(formatDatabaseUrlRemediation('postgres'));
    process.exit(1);
  }
  if (username !== QUANTUM_ADMIN && !authorityHasQuantumAdmin(trimmed)) {
    console.error(formatDatabaseUrlRemediation('not_quantum_admin'));
    process.exit(1);
  }
}

/**
 * Strict enforcement — call only when opening DB connections (Prisma, pg Pool).
 * @throws Error when URL is missing, invalid, uses `postgres`, or identity is not `quantum_admin`.
 */
export function assertAuthorizedDatabaseUrl(url: string): void {
  const trimmed = normalizeDatabaseUrlEnv(url);
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
