/**
 * Next.js instrumentation: runs once when the server starts (Node.js runtime only).
 * On Vercel Serverless, processes are ephemeral — the in-process setInterval
 * from startMarketScanner() does not run 24/7. Production scanning is done
 * by an external scheduler or systemd timer hitting GET /api/cron/scan (e.g. every 20 minutes).
 * startMarketScanner() is still useful for local/dev where the process stays up.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Infrastructure pre-flight: validates critical env vars at boot time.
    // Throws a fatal error early rather than failing silently at request time.
    const { validateInfraEnv } = await import('@/lib/env');
    validateInfraEnv();

    // ── Database connectivity probe ───────────────────────────────────────────
    // Validates that the remote Postgres at 88.99.208.99 is reachable before
    // any request handler tries to use the pool.
    try {
      const { getPrisma } = await import('@/lib/prisma');
      const db = getPrisma();
      if (db) {
        await db.$connect();
        console.log('[Instrumentation] DB BRIDGE ACTIVE — connected to 88.99.208.99:5432/postgres');
      }
    } catch (dbErr) {
      console.error(
        '[Instrumentation] DB connection FAILED:',
        dbErr instanceof Error ? dbErr.message : dbErr
      );
    }

    // ── Whale Alert Subscriber (Phase 3: AI Brain Integration) ────────────────
    // Connects to the bare-metal Rust engine's Redis at WHALE_REDIS_URL,
    // subscribes to `quant:alerts`, and pipes every anomaly through the AI
    // orchestrator. `initWhaleSubscriber` is idempotent — the globalThis guard
    // prevents duplicate TCP connections on hot-reload in development.
    try {
      const { initWhaleSubscriber } = await import('@/lib/redis/whale-subscriber');
      const { analyzeWhaleAlert } = await import('@/lib/ai/whale-analysis');
      initWhaleSubscriber(analyzeWhaleAlert);
      console.log('[Instrumentation] Whale subscriber online — listening on quant:alerts');
    } catch (err) {
      // Non-fatal: the app runs without the subscriber if Redis is unreachable at boot.
      console.error(
        '[Instrumentation] Failed to start whale subscriber:',
        err instanceof Error ? err.message : err
      );
    }
  }
}
