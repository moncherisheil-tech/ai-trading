/**
 * Next.js instrumentation: runs once when the server starts.
 * On Vercel Serverless, processes are ephemeral — the in-process setInterval
 * from startMarketScanner() does not run 24/7. Production scanning is done
 * by an external scheduler or systemd timer hitting GET /api/cron/scan (e.g. every 20 minutes).
 * startMarketScanner() is still useful for local/dev where the process stays up.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runSystemDiagnostics } = await import('@/lib/system-diagnostics');
    runSystemDiagnostics();
    const { startMarketScanner } = await import('@/lib/workers/market-scanner');
    startMarketScanner();
  }
}
