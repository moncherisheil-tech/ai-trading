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
  }
}
