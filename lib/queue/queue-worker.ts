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
 * When the queue drains, logs cycle completion and emits a cycle_drained audit event.
 *
 * Graceful shutdown on SIGTERM/SIGINT (PM2 sends SIGINT on stop).
 */

import 'dotenv/config';
import { validateInfraEnv } from '../env';

// Protocol Omega: same vault gates as Next.js boot — worker MUST NOT run with invalid secrets.
try {
  validateInfraEnv();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[Worker] [FATAL] validateInfraEnv failed — exiting:', msg);
  process.exit(1);
}

// ── Quantum Core Worker Boot ─────────────────────────────────────────────────
// Start the quantum-core-queue worker immediately so whale signals are
// processed as soon as the process is alive.
import { startQuantumWorker } from './bullmq-setup';
try {
  startQuantumWorker();
  console.log('[Worker] Quantum Core Worker started (quantum-core-queue, concurrency=1).');
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[Worker] Failed to start Quantum Core Worker (non-fatal):', msg);
}

// ── DB Graceful Boot ─────────────────────────────────────────────────────────
// If Postgres is not reachable at startup (e.g. service ordering race on boot),
// retry up to 5 times before proceeding. A failed DB check is logged but does
// NOT kill the process — BullMQ can still process jobs that don't touch the DB,
// and the retry loop inside each job handler will surface DB errors per-job.

async function waitForPostgres(
  maxAttempts = 5,
  delayMs = 5_000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { queryRaw } = await import('../db/sql');
      await queryRaw('SELECT 1');
      console.log(`[DB-RECOVERY] Postgres reachable (attempt ${attempt}/${maxAttempts}). ✓`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[DB-RECOVERY] Waiting for Postgres... (attempt ${attempt}/${maxAttempts}): ${msg}`
      );
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  console.error(
    `[DB-RECOVERY] Postgres did not respond after ${maxAttempts} attempts. ` +
    'Worker will continue — DB-dependent jobs will fail gracefully per-job.'
  );
  return false;
}

waitForPostgres().catch(() => {/* non-fatal — logged inside waitForPostgres */});

import { Worker, type Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { getRedisClient, closeRedisClient } from './redis-client';
import { disconnectPrisma } from '@/lib/prisma';
import {
  QUEUE_NAME,
  attachDrainListener,
  persistJobResult,
  customBackoffStrategy,
  closeCoinScanQueueEvents,
  getCoinScanQueue,
  setupAutoScanner,
  enqueueScanCycle,
  waitForRedisReady,
  type CoinScanJobData,
  type CoinScanJobResult,
  type TriggerMasterScanJobData,
} from './scan-queue';
import { doAnalysisCore } from '../analysis-core';
import { emitJobComplete } from '../webhooks/emitter';
import { writeAudit } from '../audit';
import { buildCandidateList } from '../workers/market-scanner';
import { getScannerSettings } from '../db/system-settings';
import type { ConnectionOptions } from 'bullmq';

/**
 * Worker concurrency — how many coin-scan jobs run in parallel.
 * Default raised from 3 → 5 now that:
 *   • Redis Cache Shield eliminates redundant Binance/News API calls (~90% reduction)
 *   • Postgres pool raised to max=50 (no more connection exhaustion)
 *   • Pinecone gated at 4 s (no more 25 s embedding blocks)
 *
 * Use QUEUE_CONCURRENCY=10 for full HFT throughput on high-spec machines,
 * or QUEUE_CONCURRENCY=2 to throttle on limited-plan DB/API tiers.
 */
const CONCURRENCY = Number(process.env.QUEUE_CONCURRENCY ?? 5);
const PER_JOB_TIMEOUT_MS = Number(process.env.QUEUE_JOB_TIMEOUT_MS ?? 150_000);
const SELF_HEAL_RESTART_DELAY_MS = 15_000;
let selfHealLoopActive = false;

/** Track cycle start times in memory (worker-local). */
const cycleStartTimes = new Map<string, number>();

async function startSelfHealLoop(reason: string, error: unknown): Promise<void> {
  if (selfHealLoopActive) {
    return;
  }
  selfHealLoopActive = true;
  const msg = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  console.error(`[Worker] [SELF-HEAL] Triggered by ${reason}:`, msg);

  while (true) {
    try {
      await new Promise((resolve) => setTimeout(resolve, SELF_HEAL_RESTART_DELAY_MS));
      await waitForRedisReady(10, 3_000, 5_000);
      await runInitSequence();
      console.log('[Worker] [SELF-HEAL] Recovery sequence succeeded.');
      selfHealLoopActive = false;
      return;
    } catch (recoveryErr) {
      const recoveryMsg = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
      console.error(
        `[Worker] [SELF-HEAL] Recovery attempt failed. Retrying in ${SELF_HEAL_RESTART_DELAY_MS / 1000}s:`,
        recoveryMsg
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Job processor
// ────────────────────────────────────────────────────────────────────────────

async function processJob(
  job: Job<CoinScanJobData | TriggerMasterScanJobData, CoinScanJobResult | void>
): Promise<CoinScanJobResult | void> {
  const start = Date.now();

  // ── Handle trigger-alpha-scan: run Tri-Core Alpha Matrix across all institutional pairs ──
  if (job.name === 'trigger-alpha-scan') {
    console.log('[Worker] Processing trigger-alpha-scan (repeatable alpha scheduler)');
    try {
      const ALPHA_SYMBOLS = [
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
        'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
        'NEARUSDT', 'LTCUSDT', 'FETUSDT', 'INJUSDT',
        'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'ATOMUSDT',
      ];
      const { runTriCoreAlphaMatrix } = await import('../alpha-engine');
      let successCount = 0;
      let failCount = 0;
      const rotationOffset = Math.floor(Date.now() / 60_000) % ALPHA_SYMBOLS.length;
      const batch = [
        ...ALPHA_SYMBOLS.slice(rotationOffset),
        ...ALPHA_SYMBOLS.slice(0, rotationOffset),
      ].slice(0, 10); // max 10 per run to respect rate limits
      for (const symbol of batch) {
        try {
          await runTriCoreAlphaMatrix(symbol);
          successCount++;
        } catch (err) {
          failCount++;
          console.warn(`[Worker] Alpha scan failed for ${symbol}:`, err instanceof Error ? err.message : err);
        }
        // Throttle between symbols
        await new Promise((resolve) => setTimeout(resolve, 4_000));
      }
      writeAudit({
        event: 'queue.alpha_scan_completed',
        level: 'info',
        meta: { successCount, failCount, batch },
      });
      console.log(`[Worker] trigger-alpha-scan completed — ${successCount} ok, ${failCount} failed`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? (err.stack ?? '') : '';
      console.error('[Worker] trigger-alpha-scan FAILED — full stack below:', msg, stack);
      writeAudit({ event: 'queue.alpha_scan_failed', level: 'error', meta: { error: msg, stack: stack.slice(0, 800) } });
      throw err;
    }
  }

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
      const stack = err instanceof Error ? (err.stack ?? '') : '';
      // Full stack trace in PM2 logs — critical for diagnosing why the scanner stalls.
      console.error('[Worker] trigger-master-scan failed:', msg, stack);
      writeAudit({
        event: 'queue.trigger_master_scan_failed',
        level: 'error',
        meta: { error: msg, stack: stack.slice(0, 800) },
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
  console.log(`[Worker] Job ${job.id} (${job.name}) completed.`);
});

worker.on('failed', (job, err) => {
  // Log full error stack so PM2 logs capture the root cause, not just a truncated message.
  console.error(
    `[Worker] Job ${job?.id} (${job?.name}) failed after ${job?.attemptsMade} attempt(s):`,
    err.message,
    err.stack ?? ''
  );
});

worker.on('error', (err) => {
  // Worker-level errors (e.g. Redis disconnect) — log full stack for visibility.
  console.error('[Worker] Worker connection/internal error:', err.message, err.stack ?? '');
});

// ── Startup sequence: Redis health-check → drain listener → auto-scanner ────
//
// ALL Redis-dependent initialisation is deferred into runInitSequence().
// Nothing that touches BullMQ Queue/QueueEvents is called at the synchronous
// module-load level, which was the root cause of the 120+ restart crash loop:
//
//   OLD flow (broken):
//     module loads → attachDrainListener() called synchronously →
//     getCoinScanQueue() → isRedisAvailable() returns false (old code) →
//     throw at module root → process exits → PM2 restarts → infinite loop
//
//   NEW flow (fixed):
//     module loads → Worker registered → runInitSequence() starts async →
//     waitForRedisReady() → attachDrainListener() → setupAutoScanner()
//     If Redis is down, the worker stays alive and IORedis reconnects.
//     If init throws, it is retried every 10 s instead of killing the process.
//
// Phase 1: waitForRedisReady() — up to 10 × 3 s = 30 s wait at boot.
// Phase 2: attachDrainListener() — safe to call once Redis is confirmed.
// Phase 3: setupAutoScanner() — registers the repeatable trigger-master-scan
//   BullMQ job with up to 5 retries before giving up (non-fatal).

async function runInitSequence(): Promise<void> {
  // Phase 0 — Single DB Boot via Orchestrator (eliminates all scattered ensureTable calls)
  try {
    const { ensureAllTablesExist } = await import('../core/orchestrator');
    await ensureAllTablesExist();
    console.log('[Worker] Orchestrator DB boot complete — all tables verified.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Orchestrator DB boot failed (non-fatal — per-job fallback active):', msg);
  }

  // Phase 1 — Redis connectivity gate
  const redisReady = await waitForRedisReady(
    10,       // up to 10 PING attempts
    3_000,    // 3 s between attempts  → up to 30 s of total wait at boot
    5_000     // 5 s per-attempt timeout
  );

  if (!redisReady) {
    console.warn(
      '[Worker] Redis did not respond before the health-check deadline. ' +
      'Proceeding anyway — IORedis retryStrategy will reconnect in the background. ' +
      'Drain listener and auto-scanner registration are deferred until Redis recovers.'
    );
  }

  // Phase 2 — Attach the drain → report trigger AFTER Redis is confirmed ready.
  // Placing this here (instead of at module-load) prevents getCoinScanQueue()
  // from throwing synchronously and killing the process before any handler fires.
  try {
    attachDrainListener(async (cycleId: string) => {
      const cycleStart = cycleStartTimes.get(cycleId) ?? Date.now();
      try {
        const durationMs = Date.now() - cycleStart;
        console.log(`[Worker] Cycle ${cycleId} drained — total duration ${durationMs}ms`);
        writeAudit({
          event: 'queue.cycle_drained',
          level: 'info',
          meta: { cycleId, durationMs },
        });
      } finally {
        cycleStartTimes.delete(cycleId);
      }
    });
    console.log('[Worker] Drain listener attached.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Worker] Failed to attach drain listener (non-fatal):', msg);
  }

  // Phase 3 — repeatable job registration with retry
  const MAX_SETUP_RETRIES = 5;
  const SETUP_RETRY_DELAY_MS = 8_000;
  for (let attempt = 1; attempt <= MAX_SETUP_RETRIES; attempt++) {
    try {
      await setupAutoScanner();
      console.log('[Worker] Auto-scanner scheduler initialized.');
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_SETUP_RETRIES) {
        console.error(
          `[Worker] setupAutoScanner failed (attempt ${attempt}/${MAX_SETUP_RETRIES}), ` +
          `retrying in ${SETUP_RETRY_DELAY_MS / 1_000}s: ${msg}`
        );
        await new Promise((resolve) => setTimeout(resolve, SETUP_RETRY_DELAY_MS));
      } else {
        console.error(
          `[Worker] setupAutoScanner failed after ${MAX_SETUP_RETRIES} retries. ` +
          'The repeatable trigger-master-scan job may not be registered. ' +
          'Use /api/cron/enqueue or PM2 restart to recover. Error:',
          msg
        );
      }
    }
  }

  // Phase 4 — Alpha-scan repeatable job (every 60 minutes)
  // Registers the Tri-Core Alpha Matrix sweep so Alpha Signals auto-populate
  // without requiring manual "Deep Scan" clicks in the dashboard.
  await setupAlphaScanner();
}

const ALPHA_SCAN_JOB_NAME = 'trigger-alpha-scan';

async function setupAlphaScanner(): Promise<void> {
  const queue = getCoinScanQueue();
  try {
    const existing = await queue.getRepeatableJobs();
    if (existing.some((j: { name: string }) => j.name === ALPHA_SCAN_JOB_NAME)) {
      console.log('[AutoAlpha] Repeatable alpha-scan job already registered; skipping.');
      return;
    }
    // removeOnComplete: false — keep completed alpha-scan jobs visible in BullMQ
    // dashboard so we can inspect execution history and diagnose stalls.
    await queue.add(
      ALPHA_SCAN_JOB_NAME,
      { triggeredAt: Date.now() } as unknown as CoinScanJobData,
      {
        repeat: { pattern: '0 * * * *' }, // every hour on the hour
        removeOnComplete: false,
        removeOnFail: false,
      }
    );
    console.log('[AutoAlpha] Repeatable alpha-scan job registered (every 60 min).');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[AutoAlpha] Failed to register alpha-scan repeatable job (non-fatal):', msg);
  }
}

// ── Worker heartbeat ─────────────────────────────────────────────────────────
// Writes a timestamp to Redis every 60 s so the diagnostics dashboard can
// detect worker death without polling BullMQ queue internals.
//   Key:  queue-worker:heartbeat
//   Value: ISO timestamp
//   TTL:  300 s (5 min) — if the worker dies, the key expires automatically.

const HEARTBEAT_KEY = 'queue-worker:heartbeat';
const HEARTBEAT_INTERVAL_MS = 60_000;

async function writeWorkerHeartbeat(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(HEARTBEAT_KEY, new Date().toISOString(), 'EX', 300);
  } catch {
    // Non-fatal: Redis may be temporarily unavailable
  }
}

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeatInterval) return;
  void writeWorkerHeartbeat(); // write immediately on start
  heartbeatInterval = setInterval(() => {
    void writeWorkerHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Top-level retry loop — if runInitSequence() throws for any reason, wait
// 10 s and try again instead of letting the process exit and triggering a
// PM2 crash-restart loop.
(async () => {
  const INIT_RETRY_DELAY_MS = 10_000;
  let initAttempt = 0;
  while (true) {
    initAttempt++;
    try {
      await runInitSequence();
      startHeartbeat();
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[Worker] [AUTO-RECOVERY] Initialization attempt ${initAttempt} failed: ${msg}. ` +
        `Retrying in ${INIT_RETRY_DELAY_MS / 1_000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, INIT_RETRY_DELAY_MS));
    }
  }
})();

console.log(
  `[Worker] BullMQ worker started — queue="${QUEUE_NAME}", concurrency=${CONCURRENCY}`
);

// ────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ────────────────────────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[Worker] ${signal} received — shutting down gracefully.`);
  stopHeartbeat();
  await worker.close();
  // Close Quantum Core Worker
  try {
    const { closeQuantumWorker, closeQuantumQueue } = await import('./bullmq-setup');
    await closeQuantumWorker();
    await closeQuantumQueue();
  } catch { /* non-fatal */ }
  // Close QueueEvents BEFORE the shared IORedis client so the event loop
  // drains cleanly. Without this, the open QueueEvents connection keeps the
  // process alive and PM2 must force-kill it after the kill timeout.
  await closeCoinScanQueueEvents();
  await closeRedisClient();
  await disconnectPrisma().catch((e) =>
    console.warn('[Worker] Prisma disconnect:', e instanceof Error ? e.message : e)
  );
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  void startSelfHealLoop('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  void startSelfHealLoop('unhandledRejection', reason);
});
