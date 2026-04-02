/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║   QUANTUM CORE QUEUE  —  BullMQ Setup  ·  Level 100,000  ║
 * ╠═══════════════════════════════════════════════════════════╣
 * ║  Queue name : quantum-core-queue                          ║
 * ║  Concurrency: 1  (strict — eliminates connection storms)  ║
 * ║  Retry      : 3 attempts, exponential backoff 2s base     ║
 * ║  DLQ        : failed jobs → failed_signals table in DB    ║
 * ║  Telemetry  : job.updateProgress + job.log at every step  ║
 * ╚═══════════════════════════════════════════════════════════╝
 */

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { getRedisClient } from '@/lib/queue/redis-client';
import { orchestrateWhaleSignal } from '@/lib/core/orchestrator';
import { writeAudit } from '@/lib/audit';

export const QUANTUM_QUEUE_NAME = 'quantum-core-queue';

// ─── Concurrency & Retry Policy ────────────────────────────────────────────
// concurrency: 1 enforces the choke-point — at most ONE whale signal being
// processed at a time, preventing Postgres connection storms.
const WORKER_CONCURRENCY = Number(process.env.QUANTUM_WORKER_CONCURRENCY ?? 1);
const JOB_ATTEMPTS = 3;
const JOB_BACKOFF_DELAY_MS = 2_000;

// ─── Queue Singleton ────────────────────────────────────────────────────────
const g = globalThis as typeof globalThis & {
  __quantumQueue?: Queue | null;
  __quantumWorker?: Worker | null;
};

export function getQuantumCoreQueue(): Queue {
  if (g.__quantumQueue) return g.__quantumQueue;
  g.__quantumQueue = new Queue(QUANTUM_QUEUE_NAME, {
    connection: getRedisClient() as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: JOB_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: JOB_BACKOFF_DELAY_MS,
      },
      removeOnComplete: { count: 200 },
      // IMMUNE SYSTEM: Never auto-remove failed jobs — they go to DLQ first.
      removeOnFail: false,
    },
  });
  console.log(
    `[QuantumQueue] Queue "${QUANTUM_QUEUE_NAME}" initialized ` +
    `(attempts=${JOB_ATTEMPTS}, backoff=exponential/${JOB_BACKOFF_DELAY_MS}ms)`
  );
  return g.__quantumQueue;
}

// ─── Worker Singleton ────────────────────────────────────────────────────────

export function startQuantumWorker(): Worker {
  if (g.__quantumWorker) return g.__quantumWorker;

  const worker = new Worker(
    QUANTUM_QUEUE_NAME,
    async (job: Job) => {
      console.log(
        `[QuantumWorker] Processing job=${job.id} name=${job.name} attempt=${job.attemptsMade + 1}/${JOB_ATTEMPTS}`
      );

      if (job.name === 'process-whale') {
        return orchestrateWhaleSignal(job);
      }

      throw new Error(`[QuantumWorker] Unknown job name: "${job.name}" — job dropped`);
    },
    {
      connection: getRedisClient() as unknown as ConnectionOptions,
      concurrency: WORKER_CONCURRENCY,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[QuantumWorker] ✅ Job completed: id=${job.id} name=${job.name}`);
    writeAudit({
      event: 'quantum_worker.job_completed',
      level: 'info',
      meta: { jobId: job.id, jobName: job.name },
    });
  });

  worker.on('failed', async (job, err) => {
    const maxAttempts = job?.opts?.attempts ?? JOB_ATTEMPTS;
    const attemptsMade = job?.attemptsMade ?? 0;
    const isFinalFailure = attemptsMade >= maxAttempts;

    console.error(
      `[QuantumWorker] ✗ Job failed: id=${job?.id} name=${job?.name} ` +
      `attempt=${attemptsMade}/${maxAttempts} final=${isFinalFailure} — ${err.message}`
    );

    writeAudit({
      event: 'quantum_worker.job_failed',
      level: 'error',
      meta: {
        jobId: job?.id,
        jobName: job?.name,
        attempt: attemptsMade,
        maxAttempts,
        isFinalFailure,
        error: err.message,
      },
    });

    // ── IMMUNE SYSTEM: Dead Letter Queue ────────────────────────────────────
    // After all retries exhausted, save signal to DB — zero data loss.
    if (isFinalFailure && job) {
      await persistToDLQ(job, err).catch((dlqErr) => {
        console.error('[QuantumWorker] DLQ persistence ALSO failed:', dlqErr);
      });
    }
  });

  worker.on('error', (err) => {
    console.error('[QuantumWorker] Worker-level error:', err.message, err.stack ?? '');
  });

  g.__quantumWorker = worker;
  console.log(
    `[QuantumWorker] Worker started — queue="${QUANTUM_QUEUE_NAME}" concurrency=${WORKER_CONCURRENCY}`
  );
  return worker;
}

// ─── Dead Letter Queue (DLQ) ────────────────────────────────────────────────
// When a job exhausts all retries, write it to failed_signals table.
// This guarantees ZERO DATA LOSS — every whale signal is either processed
// successfully or recorded as a FAILED_SIGNAL for manual review.

async function persistToDLQ(job: Job, err: Error): Promise<void> {
  try {
    const { queryRaw } = await import('@/lib/db/sql');
    await queryRaw(
      `INSERT INTO failed_signals
        (job_id, job_name, queue_name, payload, error_message, attempts_made, failed_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (job_id) DO UPDATE
         SET error_message = EXCLUDED.error_message,
             attempts_made = EXCLUDED.attempts_made,
             failed_at     = EXCLUDED.failed_at`,
      [
        job.id ?? `dlq:${Date.now()}`,
        job.name,
        QUANTUM_QUEUE_NAME,
        JSON.stringify(job.data),
        err.message.slice(0, 2048),
        job.attemptsMade,
      ]
    );
    console.error(
      `[DLQ] ⚰ FAILED_SIGNAL persisted: job_id=${job.id} symbol=${(job.data as Record<string, unknown>)?.symbol ?? 'unknown'}`
    );
    writeAudit({
      event: 'quantum_worker.dlq_saved',
      level: 'error',
      meta: {
        jobId: job.id,
        jobName: job.name,
        symbol: (job.data as Record<string, unknown>)?.symbol,
        error: err.message.slice(0, 512),
      },
    });
  } catch (dbErr) {
    const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error(`[DLQ] CRITICAL: Cannot write to failed_signals table: ${dbMsg}`);
    console.error(`[DLQ] RAW PAYLOAD (log-only fallback): ${JSON.stringify(job.data)}`);
  }
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

export async function closeQuantumWorker(): Promise<void> {
  if (g.__quantumWorker) {
    await g.__quantumWorker.close();
    g.__quantumWorker = null;
    console.log('[QuantumWorker] Closed gracefully.');
  }
}

export async function closeQuantumQueue(): Promise<void> {
  if (g.__quantumQueue) {
    await g.__quantumQueue.close();
    g.__quantumQueue = null;
    console.log('[QuantumQueue] Closed gracefully.');
  }
}
