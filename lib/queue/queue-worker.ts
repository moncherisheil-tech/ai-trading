/**
 * BullMQ Queue Worker — standalone PM2 process.
 *
 * Run via PM2 (see ecosystem.config.js):
 *   pm2 start ecosystem.config.js --only queue-worker
 *
 * Processes coin-scan jobs with concurrency=QUEUE_CONCURRENCY (default 3).
 * Each job:
 *   1. Calls doAnalysisCore() for the symbol
 *   2. Wraps LLM calls via circuit breaker (handled inside alpha-engine.ts)
 *   3. Persists the result to Redis for the report generator
 *   4. Emits a job_complete SSE event
 *
 * When the queue drains, triggers generateTieredReport().
 *
 * Graceful shutdown on SIGTERM/SIGINT (PM2 sends SIGINT on stop).
 */

import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { getRedisClient, closeRedisClient } from './redis-client';
import {
  QUEUE_NAME,
  attachDrainListener,
  persistJobResult,
  customBackoffStrategy,
  closeCoinScanQueueEvents,
  setupAutoScanner,
  enqueueScanCycle,
  type CoinScanJobData,
  type CoinScanJobResult,
  type TriggerMasterScanJobData,
} from './scan-queue';
import { doAnalysisCore } from '@/lib/analysis-core';
import { generateTieredReport } from '@/lib/reports/tiered-report-generator';
import { emitJobComplete } from '@/lib/webhooks/emitter';
import { writeAudit } from '@/lib/audit';
import { buildCandidateList } from '@/lib/workers/market-scanner';
import { getScannerSettings } from '@/lib/db/system-settings';
import type { ConnectionOptions } from 'bullmq';

const CONCURRENCY = Number(process.env.QUEUE_CONCURRENCY ?? 3);
const PER_JOB_TIMEOUT_MS = Number(process.env.QUEUE_JOB_TIMEOUT_MS ?? 150_000);

/** Track cycle start times in memory (worker-local). */
const cycleStartTimes = new Map<string, number>();

// ────────────────────────────────────────────────────────────────────────────
// Job processor
// ────────────────────────────────────────────────────────────────────────────

async function processJob(
  job: Job<CoinScanJobData | TriggerMasterScanJobData, CoinScanJobResult | void>
): Promise<CoinScanJobResult | void> {
  const start = Date.now();

  // ── Handle trigger-master-scan: enqueue all candidates ──
  if (job.name === 'trigger-master-scan') {
    console.log('[Worker] Processing trigger-master-scan (repeatable scheduler)');
    try {
      const settings = await getScannerSettings();
      if (settings && !settings.scanner_is_active) {
        console.log('[Worker] Scanner disabled in settings; skipping this cycle.');
        writeAudit({ event: 'queue.scanner_disabled', level: 'info' });
        return;
      }

      const cycleId = randomUUID();
      const { candidates, macroCtx } = await buildCandidateList();

      if (candidates.length === 0) {
        console.log('[Worker] No candidates found for this cycle.');
        writeAudit({ event: 'queue.trigger_no_candidates', level: 'warn', meta: { cycleId } });
        return;
      }

      await enqueueScanCycle(candidates, cycleId, macroCtx);
      const durationMs = Date.now() - start;

      writeAudit({
        event: 'queue.trigger_master_scan_executed',
        level: 'info',
        meta: { cycleId, count: candidates.length, durationMs },
      });

      console.log(
        `[Worker] trigger-master-scan completed in ${durationMs}ms — enqueued ${candidates.length} jobs for cycle ${cycleId}`
      );
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Worker] trigger-master-scan failed:', msg);
      writeAudit({
        event: 'queue.trigger_master_scan_failed',
        level: 'error',
        meta: { error: msg },
      });
      throw err;
    }
  }

  // ── Handle standard scan job: analyze a single symbol ──
  const jobData = job.data as CoinScanJobData;
  const { symbol, cycleId, macroCtx } = jobData;

  if (!cycleStartTimes.has(cycleId)) {
    cycleStartTimes.set(cycleId, start);
  }

  console.log(`[Worker] Processing ${symbol} (cycle=${cycleId}, attempt=${job.attemptsMade + 1})`);

  const result: CoinScanJobResult = {
    symbol,
    cycleId,
    analysisData: null,
    durationMs: 0,
  };

  try {
    const analysisResult = await Promise.race([
      doAnalysisCore(symbol, Date.now(), false, {
        skipGemAlert: true,
        precomputedMacro: macroCtx ?? undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Per-job analysis timeout')), PER_JOB_TIMEOUT_MS)
      ),
    ]);

    result.analysisData = analysisResult.data as unknown as Record<string, unknown>;

    // ── Bridge quantitative inputs so extractAlphaInput() can consume them ──
    // These fields are absent from PredictionRecord but required by the Alpha
    // Matrix for dynamic Stop Loss and precise tier classification.
    const qf = analysisResult.quantFields;
    result.analysisData = {
      ...result.analysisData,
      vwap:            qf.vwap,
      cvd_slope:       qf.cvd_slope,
      atr_14:          qf.atr_14,
      closes_20:       qf.closes_20,
      whale_confirmed: qf.whale_confirmed,
    };
    // ────────────────────────────────────────────────────────────────────────

    // Map tri-core probabilities from actual PredictionRecord fields:
    //   groq      → tech_score      (Technician — Groq primary, 35% Alpha Matrix weight)
    //   anthropic → onchain_score   (On-Chain Sleuth — Anthropic primary, 40% weight)
    //   gemini    → final_confidence or average of remaining Gemini-driven experts (25% weight)
    const d = result.analysisData;
    const probDefault = (d?.probability as number | undefined) ?? 55;
    result.triCoreProbabilities = {
      groq:      (d?.tech_score as number | undefined) ?? probDefault,
      anthropic: (d?.onchain_score as number | undefined) ?? probDefault,
      gemini:    (d?.final_confidence as number | undefined) ??
                 (((d?.psych_score as number | undefined) ?? probDefault) +
                  ((d?.macro_score as number | undefined) ?? probDefault) +
                  ((d?.deep_memory_score as number | undefined) ?? probDefault)) / 3,
    };

    result.durationMs = Date.now() - start;
    console.log(`[Worker] ${symbol} completed in ${result.durationMs}ms`);

    writeAudit({
      event: 'queue.job_complete',
      level: 'info',
      meta: { symbol, cycleId, durationMs: result.durationMs },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = msg;
    result.durationMs = Date.now() - start;

    console.error(`[Worker] ${symbol} failed (${result.durationMs}ms): ${msg}`);
    writeAudit({
      event: 'queue.job_failed',
      level: 'error',
      meta: { symbol, cycleId, error: msg, attempt: job.attemptsMade + 1 },
    });

    // Re-throw so BullMQ applies retry with backoff
    throw err;
  }

  await persistJobResult(result);

  const tier = (result.analysisData?.predicted_tier as string | undefined) ?? 'UNRANKED';
  const alphaScore = (result.analysisData?.alpha_score as number | undefined) ?? 0;
  emitJobComplete(symbol, tier, alphaScore);

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Worker setup
// ────────────────────────────────────────────────────────────────────────────

const connection = getRedisClient() as unknown as ConnectionOptions;

const worker = new Worker<CoinScanJobData | TriggerMasterScanJobData, CoinScanJobResult | void>(
  QUEUE_NAME,
  processJob,
  {
    connection,
    concurrency: CONCURRENCY,
    settings: {
      backoffStrategy: customBackoffStrategy,
    },
  }
);

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed.`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed (${job?.attemptsMade} attempts):`, err.message);
});

worker.on('error', (err) => {
  console.error('[Worker] Worker error:', err.message);
});

// ────────────────────────────────────────────────────────────────────────────
// Drain → report trigger
// ────────────────────────────────────────────────────────────────────────────

attachDrainListener(async (cycleId: string) => {
  const cycleStart = cycleStartTimes.get(cycleId) ?? Date.now();
  try {
    await generateTieredReport(cycleId, cycleStart);
  } finally {
    cycleStartTimes.delete(cycleId);
  }
});

// Initialize the auto-scanner repeatable job on startup
setupAutoScanner()
  .then(() => {
    console.log('[Worker] Auto-scanner scheduler initialized.');
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Failed to initialize auto-scanner:', msg);
    process.exit(1);
  });

console.log(
  `[Worker] BullMQ worker started — queue="${QUEUE_NAME}", concurrency=${CONCURRENCY}`
);

// ────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ────────────────────────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[Worker] ${signal} received — shutting down gracefully.`);
  await worker.close();
  // Close QueueEvents BEFORE the shared IORedis client so the event loop
  // drains cleanly. Without this, the open QueueEvents connection keeps the
  // process alive and PM2 must force-kill it after the kill timeout.
  await closeCoinScanQueueEvents();
  await closeRedisClient();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
