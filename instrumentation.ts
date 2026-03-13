/**
 * Next.js instrumentation: runs once when the server starts.
 * Starts the Live Scanning Worker (market scanner) for 24/7 gem detection.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMarketScanner } = await import('@/lib/workers/market-scanner');
    startMarketScanner();
  }
}
