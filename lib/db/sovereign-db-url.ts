/**
 * Sovereign DB URL policy: production runtime requires `quantum_admin` in the URL,
 * disallows PostgreSQL user `root` unless the process is PM2-managed.
 * Build-phase immunity allows Next/Prisma config to load without failing CI.
 */

export function isDbConfigBuildPhaseImmune(): boolean {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE === 'phase-production-build') {
    return true;
  }
  if (process.env.IS_BUILD_PROCESS === 'true') {
    return true;
  }
  return false;
}

/** True when running under PM2 (child processes receive pm_id). */
export function isPm2ManagedProcess(): boolean {
  return typeof process.env.pm_id === 'string' && process.env.pm_id.length > 0;
}

/**
 * Enforces runtime DB URL policy. During build immunity, skips all checks (no-op).
 * @throws Error with message Security Breach when policy is violated.
 */
export function assertAuthorizedDatabaseUrl(url: string): void {
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
  if (dbUser === 'root' && !isPm2ManagedProcess()) {
    throw new Error('Security Breach: Unauthorized DB User Attempted');
  }
  if (!parsed.hostname || parsed.hostname === 'base') {
    throw new Error('invalid database host');
  }
}
