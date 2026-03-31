/**
 * POST /api/cron/alpha-scan
 *
 * Automated background Alpha Scanner — runs the Tri-Core Alpha Matrix
 * (Groq / Anthropic / Gemini) across all institutional USDT pairs and
 * persists results to the AlphaSignalRecord table.
 *
 * Called:
 *   • By the BullMQ queue-worker as a repeatable cron job (every 60 min).
 *   • Manually via curl/dashboard for on-demand full sweeps.
 *
 * Design:
 *   • Processes symbols sequentially (not parallel) to respect LLM rate limits.
 *   • Hard cap: MAX_SYMBOLS_PER_RUN per invocation so one HTTP call never times out.
 *   • Each symbol is wrapped in its own try/catch — one failure never aborts the sweep.
 *   • Returns a summary JSON so callers can confirm progress.
 */

import { NextResponse } from 'next/server';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min max for full sweep

/** Maximum symbols to scan per single cron invocation. */
const MAX_SYMBOLS_PER_RUN = 12;

/** Delay between symbols to respect Groq / Anthropic RPM limits. */
const INTER_SYMBOL_DELAY_MS = 4_000;

/**
 * Institutional-grade scan list — ordered by market cap / relevance.
 * Matches INSTITUTIONAL_USDT_PAIRS in AlphaSignalsDashboard.tsx.
 */
const ALPHA_SCAN_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
  'NEARUSDT', 'LTCUSDT', 'BCHUSDT', 'FETUSDT', 'INJUSDT',
  'RNDRUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'APTUSDT',
  'ATOMUSDT', 'TIAUSDT', 'LDOUSDT', 'RUNEUSDT',
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const runId = `alpha-sweep-${startMs}`;
  const results: Array<{ symbol: string; ok: boolean; createdIds?: string[]; error?: string }> = [];

  writeAudit({ event: 'alpha_scan.sweep_started', level: 'info', meta: { runId, total: ALPHA_SCAN_SYMBOLS.length } });

  // Rotate which symbols get processed first based on minute-of-day so over time
  // every symbol gets coverage even when runs are rate-limited or timed out early.
  const rotationOffset = Math.floor(Date.now() / 60_000) % ALPHA_SCAN_SYMBOLS.length;
  const rotated = [
    ...ALPHA_SCAN_SYMBOLS.slice(rotationOffset),
    ...ALPHA_SCAN_SYMBOLS.slice(0, rotationOffset),
  ].slice(0, MAX_SYMBOLS_PER_RUN);

  const { runTriCoreAlphaMatrix } = await import('@/lib/alpha-engine');

  for (const symbol of rotated) {
    try {
      const { createdIds } = await runTriCoreAlphaMatrix(symbol);
      results.push({ symbol, ok: true, createdIds });
      console.log(`[AlphaScan] ${symbol} ✓ — ${createdIds.length} signals created`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ symbol, ok: false, error: msg });
      console.warn(`[AlphaScan] ${symbol} ✗ — ${msg}`);
    }
    // Respect LLM rate limits between symbols
    await sleep(INTER_SYMBOL_DELAY_MS);
  }

  const durationMs = Date.now() - startMs;
  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  writeAudit({
    event: 'alpha_scan.sweep_completed',
    level: 'info',
    meta: { runId, successCount, failCount, durationMs },
  });

  return NextResponse.json({
    ok: true,
    runId,
    scanned: rotated.length,
    successCount,
    failCount,
    durationMs,
    results,
  });
}

/** GET: health check / status — returns the list of symbols this cron covers. */
export async function GET(request: Request): Promise<NextResponse> {
  const token = getAuthorizedToken(request);
  if (token === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    symbols: ALPHA_SCAN_SYMBOLS,
    maxPerRun: MAX_SYMBOLS_PER_RUN,
    interSymbolDelayMs: INTER_SYMBOL_DELAY_MS,
    note: 'POST this endpoint to trigger an immediate full alpha sweep.',
  });
}
