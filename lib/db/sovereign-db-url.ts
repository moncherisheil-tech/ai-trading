/**
 * DATABASE_URL validation: accepts any postgres:// or postgresql:// URL from the environment.
 * There is no enforced database username — trust your hosting provider and connection string.
 * Parses with the WHATWG `URL` API; last authorized URL string is cached for hot paths.
 * Enforced when opening DB connections (`lib/prisma.ts`, `lib/db/sql.ts`).
 * Do not import from `prisma.config.ts` — Prisma CLI loads config outside app runtime.
 *
 * ─── SPECIAL CHARACTERS IN PASSWORDS ────────────────────────────────────────
 * If your Postgres password contains special characters, they MUST be
 * percent-encoded inside the DATABASE_URL or the pg driver will reject the
 * connection with "password authentication failed" (error code 28P01).
 *
 *   Common encodings:
 *     @  →  %40      #  →  %23      ?  →  %3F      /  →  %2F
 *     :  →  %3A      [  →  %5B      ]  →  %5D      !  →  %21
 *     $  →  %24      &  →  %26      +  →  %2B      =  →  %3D
 *
 *   Example — password "my@p#ss!1" must be written as "my%40p%23ss%211":
 *     DATABASE_URL=postgresql://postgres:my%40p%23ss%211@127.0.0.1:5432/mydb
 *
 *   Quick encoder (Node REPL):
 *     node -e "console.log(encodeURIComponent('your_password_here'))"
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Same URL string → skip re-parse (hot paths: `lib/db/sql.ts` + this module). */
let lastAuthorizedUrl: string | null = null;

/**
 * Extracts the raw (un-decoded) password segment from a Postgres connection URL
 * WITHOUT using the WHATWG URL parser, so we can inspect it for unencoded
 * special characters before the parser silently truncates or misinterprets them.
 *
 * Returns null when the URL has no userinfo section or no password component.
 */
function extractRawPassword(rawUrl: string): string | null {
  const protoEnd = rawUrl.indexOf('://');
  if (protoEnd === -1) return null;
  const afterProto = rawUrl.slice(protoEnd + 3);
  // The last '@' in the userinfo block is the userinfo/host separator.
  const lastAt = afterProto.lastIndexOf('@');
  if (lastAt === -1) return null;
  const userinfo = afterProto.slice(0, lastAt);
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx === -1) return null;
  return userinfo.slice(colonIdx + 1);
}

/**
 * Characters inside a Postgres URL password that MUST be percent-encoded.
 * Presence of any of these as a literal character (not inside a %XX sequence)
 * causes the URL parser to misinterpret the connection string, producing a
 * silent wrong password — which surfaces as error code 28P01 from Postgres.
 */
const MUST_ENCODE_RE = /[@#?/[\]:]/;

/**
 * Returns true when `rawPassword` contains characters that need percent-encoding
 * but appear as raw literals (i.e., not already encoded as %XX sequences).
 */
function hasUnencodedSpecialChars(rawPassword: string): boolean {
  const stripped = rawPassword.replace(/%[0-9A-Fa-f]{2}/g, '');
  return MUST_ENCODE_RE.test(stripped);
}

let warnedSpecialChars = false;

/**
 * Emits a one-time console warning when the DATABASE_URL password contains
 * unencoded special characters that will cause "28P01 authentication failed".
 */
function warnIfPasswordHasSpecialChars(rawUrl: string): void {
  if (warnedSpecialChars) return;
  const pwd = extractRawPassword(rawUrl);
  if (!pwd || !hasUnencodedSpecialChars(pwd)) return;
  warnedSpecialChars = true;
  console.warn(
    '\n' +
    '╔══════════════════════════════════════════════════════════════╗\n' +
    '║  [DATABASE_URL] ⚠  UNENCODED SPECIAL CHARS IN PASSWORD      ║\n' +
    '╠══════════════════════════════════════════════════════════════╣\n' +
    '║  Your DATABASE_URL password contains characters that MUST   ║\n' +
    '║  be percent-encoded, or Postgres will reject the connection  ║\n' +
    '║  with "password authentication failed" (error 28P01).       ║\n' +
    '║                                                              ║\n' +
    '║  Common encodings:                                           ║\n' +
    '║    @  →  %40    #  →  %23    ?  →  %3F    /  →  %2F        ║\n' +
    '║    :  →  %3A    [  →  %5B    ]  →  %5D    !  →  %21        ║\n' +
    '║                                                              ║\n' +
    '║  Quick fix (Node REPL):                                      ║\n' +
    '║    node -e "console.log(encodeURIComponent(\'PASSWORD\'))"    ║\n' +
    '║                                                              ║\n' +
    '║  Then update .env:                                           ║\n' +
    '║    DATABASE_URL=postgresql://user:ENCODED_PW@host:5432/db   ║\n' +
    '╚══════════════════════════════════════════════════════════════╝\n'
  );
}

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
 * Emits a one-time warning when the password contains unencoded special chars
 * that would cause "password authentication failed" (28P01).
 */
export function assertAuthorizedDatabaseUrl(url: string): void {
  const trimmed = normalizeDatabaseUrlEnv(url);
  if (!trimmed) {
    throw new Error('DATABASE_URL is not set or is empty.');
  }

  // Special-char guard fires even on repeated calls (uses its own once-flag).
  warnIfPasswordHasSpecialChars(trimmed);

  if (trimmed === lastAuthorizedUrl) {
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // URL parse failure is a strong signal that the password contains characters
    // like '@' or '#' that break the URL structure when un-encoded.
    console.error(
      '[DATABASE_URL] Failed to parse as a valid URL.\n' +
      '  If your password contains special characters (@, #, ?, /, :, etc.),\n' +
      '  you MUST percent-encode them:\n' +
      '    node -e "console.log(encodeURIComponent(\'YOUR_PASSWORD\'))"\n' +
      '  Then update DATABASE_URL in .env with the encoded password.'
    );
    throw new Error(
      'DATABASE_URL is invalid. Use a full PostgreSQL URL (postgres://... or postgresql://...).\n' +
      'If your password has special characters, encode them with encodeURIComponent().'
    );
  }

  if (!isPostgresProtocol(parsed.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql:// protocol.');
  }

  lastAuthorizedUrl = trimmed;
}
