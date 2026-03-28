/**
 * DATABASE_URL validation: accepts any postgres:// or postgresql:// URL from the environment.
 * There is no enforced database username — trust your hosting provider and connection string.
 * Parses with the WHATWG `URL` API; last authorized URL string is cached for hot paths.
 * Enforced when opening DB connections (`lib/prisma.ts`, `lib/db/sql.ts`).
 * Do not import from `prisma.config.ts` — Prisma CLI loads config outside app runtime.
 */

/** Same URL string → skip re-parse (hot paths: `lib/db/sql.ts` + this module). */
let lastAuthorizedUrl: string | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function isPostgresProtocol(protocol: string): boolean {
  const p = protocol.toLowerCase();
  return p === 'postgresql:' || p === 'postgres:';
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
    if (!isPostgresProtocol(parsed.protocol)) {
      return { username: null, parseError: true };
    }
    const u = decodeURIComponent(parsed.username || '');
    return { username: u || null, parseError: false };
  } catch {
    return { username: null, parseError: true };
  }
}

/** Human-readable remediation for operators (startup audit / logs). */
export function formatDatabaseUrlRemediation(reason: 'invalid' | 'missing'): string {
  const lines = [
    '[DATABASE_URL] Set a valid PostgreSQL connection string.',
    '',
    'Fix your server .env (or PM2 env):',
    '  DATABASE_URL=postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?schema=public',
    '',
    'Then: save the file, restart the app (e.g. pm2 restart all).',
  ];
  if (reason === 'invalid') {
    lines.splice(1, 0, 'Detected: DATABASE_URL is not a valid postgres:// or postgresql:// URL.');
  } else {
    lines.splice(
      1,
      0,
      'DATABASE_URL is empty. Set it if you need persistence, cron DB routes, or the Telegram terminal.'
    );
  }
  return lines.join('\n');
}

/**
 * Fail fast in production with operator-friendly instructions (before first DB connection).
 */
export function runProductionDatabaseUrlGate(): void {
  if (!isProduction()) return;
  const trimmed = normalizeDatabaseUrlEnv(process.env.DATABASE_URL);
  if (!trimmed) {
    console.error(formatDatabaseUrlRemediation('missing'));
    process.exit(1);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    console.error(formatDatabaseUrlRemediation('invalid'));
    process.exit(1);
  }
  if (!isPostgresProtocol(parsed.protocol)) {
    console.error(formatDatabaseUrlRemediation('invalid'));
    process.exit(1);
  }
}

/**
 * Call when opening DB connections (Prisma, pg Pool).
 * Ensures a non-empty, parseable postgres:// or postgresql:// URL.
 */
export function assertAuthorizedDatabaseUrl(url: string): void {
  const trimmed = normalizeDatabaseUrlEnv(url);
  if (!trimmed) {
    throw new Error('DATABASE_URL is not set or is empty.');
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

  if (!isPostgresProtocol(parsed.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql:// protocol.');
  }

  lastAuthorizedUrl = trimmed;
}
