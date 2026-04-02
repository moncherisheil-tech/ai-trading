/**
 * Global DB Init Guard
 *
 * Set by the Orchestrator after ensureAllTablesExist() completes.
 * Individual module-level ensureTable() functions check this flag and
 * short-circuit immediately if the Orchestrator already bootstrapped the schema.
 *
 * This eliminates redundant DDL storms caused by every module self-bootstrapping
 * on first use. In production the Orchestrator always runs before any job is
 * processed, so ensureTable in component files becomes a no-op.
 */

const g = globalThis as typeof globalThis & {
  __orchestratorTablesReady?: boolean;
  __orchestratorTablesInitPromise?: Promise<void> | null;
};

/** Called by lib/core/orchestrator.ts after all DDL completes successfully. */
export function markTablesReady(): void {
  g.__orchestratorTablesReady = true;
}

/** Returns true once the Orchestrator has verified all tables exist. */
export function areTablesReady(): boolean {
  return g.__orchestratorTablesReady === true;
}

/** Store the in-flight init promise so concurrent callers await the same run. */
export function setTablesInitPromise(p: Promise<void>): void {
  g.__orchestratorTablesInitPromise = p;
}

export function getTablesInitPromise(): Promise<void> | null | undefined {
  return g.__orchestratorTablesInitPromise;
}
