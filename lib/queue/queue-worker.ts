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
import { getRedisClient, closeRedisClient } from './redis-client';
import {
  QUEUE_NAME,
  attachDrainListener,
  persistJobResult,
  customBackoffStrategy,
  type CoinScanJobData,
  type CoinScanJobResult,
} from './scan-queue';
import { doAnalysisCore } from '@/lib/analysis-core';
import { generateTieredReport } from '@/lib/reports/tiered-report-generator';
import { emitJobComplete } from '@/lib/webhooks/emitter';
import { writeAudit } from '@/lib/audit';
import type { ConnectionOptions } from 'bullmq';

const CONCURRENCY = Number(process.env.QUEUE_CONCURRENCY ?? 3);
const PER_JOB_TIMEOUT_MS = Number(process.env.QUEUE_JOB_TIMEOUT_MS ?? 150_000);

/** Track cycle start times in memory (worker-local). */
const cycleStartTimes = new Map<string, number>();

// ────────────────────────────────────────────────────────────────────────────
// Job processor
// ────────────────────────────────────────────────────────────────────────────

async function processJob(
  job: Job<CoinScanJobData, CoinScanJobResult>
): Promise<CoinScanJobResult> {
  const { symbol, cycleId, macroCtx } = job.data;
  const start = Date.now();

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

    // Extract tri-core probabilities from analysis data if available
    const d = result.analysisData;
    const probDefault = (d?.probability as number | undefined) ?? 55;
    result.triCoreProbabilities = {
      groq: (d?.alpha_hourly_probability as number | undefined) ?? probDefault,
      anthropic: (d?.alpha_daily_probability as number | undefined) ?? probDefault,
      gemini:
        (((d?.alpha_weekly_probability as number | undefined) ?? probDefault) +
          ((d?.alpha_long_probability as number | undefined) ?? probDefault)) /
        2,
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

const worker = new Worker<CoinScanJobData, CoinScanJobResult>(
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

console.log(
  `[Worker] BullMQ worker started — queue="${QUEUE_NAME}", concurrency=${CONCURRENCY}`
);

// ────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ────────────────────────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[Worker] ${signal} received — shutting down gracefully.`);
  await worker.close();
  await closeRedisClient();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
