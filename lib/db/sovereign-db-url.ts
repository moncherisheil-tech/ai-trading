/**
 * Sovereign DB URL policy: production runtime requires `quantum_admin` in the URL,
 * disallows PostgreSQL user `root` unless the process is PM2-managed.
 * Build-phase immunity allows Next/Prisma config to load without failing CI.
 *
 * No assertions run at module load — only inside explicit functions.
 */

/** Placeholder URL for Prisma schema tooling (generate/validate); never used for real queries. */
export const PRISMA_BUILD_DUMMY_DATABASE_URL =
  'postgresql://quantum_admin:sovereign_build@127.0.0.1:5432/_prisma_schema_tooling?schema=public';

/** True during Next/Prisma generate — no URL inspection; build does not run DB queries. */
export function isDbConfigBuildPhaseImmune(): boolean {
  if (process.env.IS_BUILD_PROCESS === 'true') {
    return true;
  }
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return true;
  }
  return false;
}

/** `npx prisma generate|validate|format` — argv shape: node …/prisma … <subcommand> */
function isPrismaCliSchemaOnlyCommand(): boolean {
  const a = process.argv;
  if (a[2] === 'generate' || a[2] === 'validate' || a[2] === 'format') {
    return true;
  }
  if (a[3] === 'generate' || a[3] === 'validate' || a[3] === 'format') {
    return true;
  }
  return false;
}

/** Use dummy datasource URL so Prisma config types resolve without policy checks. */
export function shouldUseDummyPrismaDatasourceUrl(): boolean {
  if (isDbConfigBuildPhaseImmune()) {
    return true;
  }
  return isPrismaCliSchemaOnlyCommand();
}

/**
 * Resolved lazily when Prisma reads `datasource.url` — not at prisma.config.ts load time.
 */
export function getDatasourceUrlForPrismaConfig(): string {
  if (shouldUseDummyPrismaDatasourceUrl()) {
    return PRISMA_BUILD_DUMMY_DATABASE_URL;
  }
  const url = process.env.DATABASE_URL?.trim() || '';
  try {
    assertAuthorizedDatabaseUrl(url);
    return url;
  } catch (err) {
    if (process.env.IS_BUILD_PROCESS === 'true') {
      return PRISMA_BUILD_DUMMY_DATABASE_URL;
    }
    throw err;
  }
}

/** True when running under PM2 (child processes receive pm_id). */
export function isPm2ManagedProcess(): boolean {
  return typeof process.env.pm_id === 'string' && process.env.pm_id.length > 0;
}

/**
 * Enforces runtime DB URL policy. During build immunity, skips all checks (no-op).
 * Build immunity is evaluated before any string analysis on the URL.
 * @throws Error with message Security Breach when policy is violated.
 */
export function assertAuthorizedDatabaseUrl(url: string): void {
  if (process.env.IS_BUILD_PROCESS === 'true') {
    return;
  }
  try {
    assertAuthorizedDatabaseUrlImpl(url);
  } catch (err) {
    if (process.env.IS_BUILD_PROCESS === 'true') {
      return;
    }
    throw err;
  }
}

function assertAuthorizedDatabaseUrlImpl(url: string): void {
  if (isDbConfigBuildPhaseImmune()) {
    return;
  }

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
  // Root forbidden in production runtime only (build phase returns above; dev may use root locally).
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
