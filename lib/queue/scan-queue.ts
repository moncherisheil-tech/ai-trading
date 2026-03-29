/**
 * BullMQ coin-scan queue.
 *
 * Each scan cycle enqueues one job per candidate coin.
 * Jobs survive server restarts (persisted in Redis).
 * Retry policy: up to 5 attempts with exponential backoff + jitter;
 * 429 errors are detected via the job error message and get a longer base delay.
 *
 * When the queue drains (all jobs done), it automatically triggers
 * the tiered report generator.
 */

import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import { getRedisClient, isRedisAvailable } from './redis-client';
import type { ExpertMacroOutput } from '@/lib/consensus-engine';

export const QUEUE_NAME = 'coin-scan';

export interface CoinScanJobData {
  symbol: string;
  cycleId: string;
  macroCtx: ExpertMacroOutput | null;
  priority: number;
  enqueuedAt: number;
}

export interface CoinScanJobResult {
  symbol: string;
  cycleId: string;
  /** Serialised AnalysisCoreResult.data — stored in Redis for report generation. */
  analysisData: Record<string, unknown> | null;
  /** Serialised tri-core probabilities for Alpha Matrix. */
  triCoreProbabilities?: {
    groq: number;
    anthropic: number;
    gemini: number;
  };
  error?: string;
  durationMs: number;
}

/** Exponential backoff with jitter, 429-aware. */
function computeBackoffMs(attemptsMade: number, error?: Error): number {
  const is429 =
    error?.message?.includes('429') ||
    error?.message?.toLowerCase().includes('rate limit') ||
    error?.message?.toLowerCase().includes('too many requests');

  const baseMs = is429 ? 4_000 : 1_000;
  const maxMs = is429 ? 64_000 : 32_000;
  const exponential = baseMs * Math.pow(2, attemptsMade);
  const jitter = Math.random() * 0.3 * exponential;
  return Math.min(exponential + jitter, maxMs);
}

let _queue: Queue<CoinScanJobData, CoinScanJobResult> | null = null;
let _queueEvents: QueueEvents | null = null;
let _drainListenerAttached = false;

function getConnection(): ConnectionOptions {
  return getRedisClient() as unknown as ConnectionOptions;
}

export function getCoinScanQueue(): Queue<CoinScanJobData, CoinScanJobResult> {
  if (_queue) return _queue;
  if (!isRedisAvailable()) {
    throw new Error('[ScanQueue] Redis unavailable. Set REDIS_URL to enable the task queue.');
  }
  _queue = new Queue<CoinScanJobData, CoinScanJobResult>(QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'custom',
      },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    },
  });
  return _queue;
}

/**
 * Returns a QueueEvents instance used for listening to drain events.
 * Created lazily and only once per process.
 */
export function getCoinScanQueueEvents(): QueueEvents {
  if (_queueEvents) return _queueEvents;
  _queueEvents = new QueueEvents(QUEUE_NAME, { connection: getConnection() });
  return _queueEvents;
}

/**
 * Attach the `drained` listener once per process.
 * `onDrained` is called with the cycleId when all jobs in a cycle complete.
 */
export function attachDrainListener(
  onDrained: (cycleId: string) => Promise<void>
): void {
  if (_drainListenerAttached) return;
  _drainListenerAttached = true;

  const events = getCoinScanQueueEvents();
  const queue = getCoinScanQueue();

  events.on('drained', async () => {
    try {
      const waiting = await queue.getWaitingCount();
      const active = await queue.getActiveCount();
      if (waiting === 0 && active === 0) {
        const cycleId = await getActiveCycleId();
        if (cycleId) {
          console.log(`[ScanQueue] Queue drained — triggering report for cycle ${cycleId}`);
          await onDrained(cycleId);
        }
      }
    } catch (err) {
      console.error('[ScanQueue] Error in drain listener:', err);
    }
  });
}

/** Track active cycle ID in Redis so the drain listener can look it up. */
const ACTIVE_CYCLE_KEY = 'scan:active_cycle_id';

async function setActiveCycleId(cycleId: string): Promise<void> {
  if (!isRedisAvailable()) return;
  await getRedisClient().set(ACTIVE_CYCLE_KEY, cycleId, 'EX', 7200); // 2h TTL
}

export async function getActiveCycleId(): Promise<string | null> {
  if (!isRedisAvailable()) return null;
  return getRedisClient().get(ACTIVE_CYCLE_KEY);
}

/**
 * Enqueue one job per candidate symbol.
 * Uses priority to process high-confidence candidates first (lower number = higher priority).
 * Returns the cycle ID.
 */
export async function enqueueScanCycle(
  candidates: string[],
  cycleId: string,
  macroCtx: ExpertMacroOutput | null
): Promise<string> {
  const queue = getCoinScanQueue();
  await setActiveCycleId(cycleId);

  const jobs = candidates.map((symbol, index) => ({
    name: `scan:${symbol}:${cycleId}`,
    data: {
      symbol,
      cycleId,
      macroCtx,
      priority: index + 1,
      enqueuedAt: Date.now(),
    } satisfies CoinScanJobData,
    opts: {
      jobId: `${cycleId}:${symbol}`,
      priority: index + 1,
      attempts: 5,
      backoff: { type: 'custom' as const },
    },
  }));

  await queue.addBulk(jobs);
  console.log(`[ScanQueue] Enqueued ${jobs.length} jobs for cycle ${cycleId}`);
  return cycleId;
}

/** Persist a completed job result to Redis for the report generator. */
export async function persistJobResult(result: CoinScanJobResult): Promise<void> {
  if (!isRedisAvailable()) return;
  const key = `scan:result:${result.cycleId}:${result.symbol}`;
  await getRedisClient().set(key, JSON.stringify(result), 'EX', 7200);
}

/** Load all persisted results for a cycle. */
export async function loadCycleResults(cycleId: string): Promise<CoinScanJobResult[]> {
  if (!isRedisAvailable()) return [];
  const r = getRedisClient();
  const keys = await r.keys(`scan:result:${cycleId}:*`);
  if (keys.length === 0) return [];
  const values = await r.mget(...keys);
  return values
    .filter(Boolean)
    .map((v) => JSON.parse(v!) as CoinScanJobResult);
}

/** Queue health counters. */
export async function getQueueCounts() {
  if (!isRedisAvailable()) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }
  const q = getCoinScanQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    q.getWaitingCount(),
    q.getActiveCount(),
    q.getCompletedCount(),
    q.getFailedCount(),
    q.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

/**
 * Custom backoff strategy.  BullMQ calls this via the Worker's `settings.backoffStrategy`.
 * Must be registered in the Worker options — exported here for use in queue-worker.ts.
 */
export function customBackoffStrategy(
  attemptsMade: number,
  _type: string,
  err?: Error
): number {
  return computeBackoffMs(attemptsMade, err);
}
