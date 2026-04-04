/**
 * Next.js instrumentation: runs once when the server starts (Node.js runtime only).
 * On Vercel Serverless, processes are ephemeral — the in-process setInterval
 * from startMarketScanner() does not run 24/7. Production scanning is done
 * by an external scheduler or systemd timer hitting GET /api/cron/scan (e.g. every 20 minutes).
 * startMarketScanner() is still useful for local/dev where the process stays up.
 */

// ─── Boot telemetry collector ──────────────────────────────────────────────────
// Each stage appends one entry; a summary banner is printed at the end of boot.
interface BootStageResult {
  stage: string;
  ok: boolean;
  detail?: string;
}

/** Print a loud, unmistakable CRITICAL banner to stderr. */
function criticalBootBanner(stage: string, err: unknown): void {
  const msg    = err instanceof Error ? err.message : String(err);
  const stack  = err instanceof Error ? (err.stack ?? '') : '';

  // Attempt to extract the specific .env key from the error message so the
  // operator knows EXACTLY which variable to add without reading source code.
  const keyMatch = msg.match(/\b([A-Z][A-Z0-9_]{3,})\b/g) ?? [];
  const envKeys  = keyMatch
    .filter((k) => k !== 'FATAL' && k !== 'BOOT' && k !== 'ERROR')
    .slice(0, 6)
    .join(', ');

  const line = '═'.repeat(70);
  console.error(`
\x1b[1m\x1b[31m${line}
  ██████╗ ██████╗ ██╗████████╗██╗ ██████╗ █████╗ ██╗
 ██╔════╝██╔══██╗██║╚══██╔══╝██║██╔════╝██╔══██╗██║
 ██║     ██████╔╝██║   ██║   ██║██║     ███████║██║
 ██║     ██╔══██╗██║   ██║   ██║██║     ██╔══██║██║
 ╚██████╗██║  ██║██║   ██║   ██║╚██████╗██║  ██║███████╗
  ╚═════╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝
  BOOT FAILURE  —  STAGE: ${stage}
${line}\x1b[0m
\x1b[33m  ERROR   : ${msg}\x1b[0m
\x1b[33m  ENV KEYS: ${envKeys || '(could not extract — see full message above)'}\x1b[0m
\x1b[2m${stack}\x1b[0m
\x1b[31m${line}
  ACTION  : Open your .env file and add / fix the keys listed above.
  DOCS    : See .env.example for the correct format of each variable.
  SERVER  : Continuing startup — DB bootstrap still runs; fix .env and restart.
${line}\x1b[0m
`);
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const bootStages: BootStageResult[] = [];

    // ── Stage 1: Env Pre-flight ────────────────────────────────────────────────
    // validateInfraEnv() throws on ANY missing/invalid critical key.
    // We MUST catch it here — an uncaught throw from register() crashes the
    // entire boot sequence, meaning the DB bootstrapper never runs, and every
    // subsequent request returns a Silent 500 (confirmed production bug).
    try {
      const { validateInfraEnv } = await import('@/lib/env');
      validateInfraEnv();
      console.log('[Instrumentation] ✅ Stage 1 — Env pre-flight PASSED.');
      bootStages.push({ stage: 'Env pre-flight', ok: true });
    } catch (envErr) {
      criticalBootBanner('Env pre-flight', envErr);
      bootStages.push({
        stage: 'Env pre-flight',
        ok: false,
        detail: envErr instanceof Error ? envErr.message : String(envErr),
      });
      // Do NOT re-throw. The DB bootstrapper and whale subscriber must still
      // run — they have their own fallback guards and independent error handling.
    }

    // ── Stage 2: Database connectivity probe ──────────────────────────────────
    // Validates that the configured remote Postgres is reachable before any
    // request handler tries to use the pool. Host is read live from DATABASE_URL
    // so the log always reflects the active server.
    try {
      const { getPrisma } = await import('@/lib/prisma');
      const { normalizeDatabaseUrlEnv } = await import('@/lib/db/sovereign-db-url');
      const db = getPrisma();
      if (db) {
        const rawUrl = normalizeDatabaseUrlEnv(process.env.DATABASE_URL ?? '');
        let dbLabel = 'unknown-host';
        let dbName  = 'unknown-db';
        try {
          const parsed = new URL(rawUrl);
          dbLabel = `${parsed.hostname}:${parsed.port || '5432'}`;
          dbName  = parsed.pathname.replace(/^\//, '') || 'postgres';
        } catch { /* keep defaults */ }
        await db.$connect();
        console.log(`[Instrumentation] ✅ Stage 2 — DB BRIDGE ACTIVE — connected to ${dbLabel}/${dbName}`);
        bootStages.push({ stage: `DB bridge (${dbLabel}/${dbName})`, ok: true });
      } else {
        bootStages.push({ stage: 'DB bridge', ok: false, detail: 'getPrisma() returned null' });
      }
    } catch (dbErr) {
      const detail = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error('[Instrumentation] ❌ Stage 2 — DB connection FAILED:', detail);
      bootStages.push({ stage: 'DB bridge', ok: false, detail });
    }

    // ── Stage 3: Central DB Schema Bootstrapper ───────────────────────────────
    // Runs ALL CREATE TABLE statements sequentially exactly once at server boot,
    // before any API route or BullMQ worker can fire. This eliminates the
    // concurrent ECONNREFUSED storm caused by per-component ensureTable() calls.
    try {
      const { runDbBootstrapper } = await import('@/lib/core/db-bootstrapper');
      await runDbBootstrapper();
      console.log('[Instrumentation] ✅ Stage 3 — DB bootstrapper COMPLETE.');
      bootStages.push({ stage: 'DB bootstrapper (DDL)', ok: true });
    } catch (bootstrapErr) {
      const detail = bootstrapErr instanceof Error ? bootstrapErr.message : String(bootstrapErr);
      // Non-fatal at boot so the server still starts; individual queries will
      // surface proper errors if tables are genuinely missing.
      console.error('[Instrumentation] ❌ Stage 3 — DB bootstrapper FAILED:', detail);
      bootStages.push({ stage: 'DB bootstrapper (DDL)', ok: false, detail });
    }

    // ── Stage 4: Whale Alert Subscriber ──────────────────────────────────────
    // Connects to the bare-metal Rust engine's Redis at WHALE_REDIS_URL,
    // subscribes to `quant:alerts`, and pipes every anomaly through the AI
    // orchestrator. `initWhaleSubscriber` is idempotent — the globalThis guard
    // prevents duplicate TCP connections on hot-reload in development.
    try {
      const { initWhaleSubscriber } = await import('@/lib/redis/whale-subscriber');
      initWhaleSubscriber();
      console.log('[Instrumentation] ✅ Stage 4 — Whale subscriber ONLINE (quant:alerts).');
      bootStages.push({ stage: 'Whale subscriber (Redis)', ok: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Non-fatal: the app runs without the subscriber if Redis is unreachable at boot.
      console.error('[Instrumentation] ❌ Stage 4 — Whale subscriber FAILED:', detail);
      bootStages.push({ stage: 'Whale subscriber (Redis)', ok: false, detail });
    }

    // ── Boot Summary Banner ───────────────────────────────────────────────────
    const passed = bootStages.filter((s) => s.ok).length;
    const failed = bootStages.filter((s) => !s.ok).length;
    const allOk  = failed === 0;
    const colour = allOk ? '\x1b[32m' : '\x1b[33m';
    const icon   = allOk ? '✅' : '⚠️ ';

    console.log(`\n\x1b[1m${colour}┌─ BOOT SEQUENCE COMPLETE — ${passed}/${bootStages.length} stages OK ─────────────────┐\x1b[0m`);
    for (const s of bootStages) {
      const mark   = s.ok ? '\x1b[32m ✅\x1b[0m' : '\x1b[31m ❌\x1b[0m';
      const suffix = s.ok ? '' : `\x1b[2m  ← ${s.detail ?? 'unknown error'}\x1b[0m`;
      console.log(`\x1b[1m${colour}│\x1b[0m${mark}  ${s.stage}${suffix}`);
    }
    console.log(`\x1b[1m${colour}└────────────────────────────────────────────────────────────────┘\x1b[0m`);

    if (!allOk) {
      console.error(
        `\x1b[33m[Instrumentation] ${icon} ${failed} boot stage(s) failed — ` +
        `server is running in degraded mode. Fix .env and restart.\x1b[0m\n`
      );
    } else {
      console.log(`\x1b[32m[Instrumentation] 🚀 All systems nominal — server is fully operational.\x1b[0m\n`);
    }

    // ── Shutdown hooks ────────────────────────────────────────────────────────
    const onShutdown = async (sig: string) => {
      try {
        const { disconnectPrisma } = await import('@/lib/prisma');
        await disconnectPrisma();
        console.log(`[Instrumentation] ${sig} — Prisma disconnected.`);
      } catch (e) {
        console.warn('[Instrumentation] Prisma shutdown:', e instanceof Error ? e.message : e);
      }
    };
    process.once('SIGTERM', () => void onShutdown('SIGTERM'));
    process.once('SIGINT',  () => void onShutdown('SIGINT'));
  }
}
