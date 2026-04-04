/**
 * Whale Alert Redis Subscriber  —  CHOKE POINT
 *
 * THIS MODULE DOES ZERO PROCESSING.
 *
 * Its only responsibility: receive a raw payload from the Rust ingestion
 * engine (WS2 via WHALE_REDIS_URL) and immediately enqueue it into the
 * quantum-core-queue.  All analysis, validation, and AI calls happen
 * exclusively inside the Orchestrator (lib/core/orchestrator.ts).
 *
 * ┌─────────────────────────────────────────────────────┐
 * │  WHALE_REDIS_URL  →  WhaleSubscriber._dispatch()    │
 * │      → quantum-core-queue.add('process-whale', …)   │
 * │          → Orchestrator.orchestrateWhaleSignal()    │
 * └─────────────────────────────────────────────────────┘
 *
 * Singleton pattern via `globalThis` survives Next.js hot-reload.
 * Exponential back-off, gives up after 50 attempts (~8 min cumulative).
 */

import IORedis from 'ioredis';

export interface WhaleAlert {
  symbol: string;
  anomaly_type: string;
  delta_pct: number;
  timestamp: string;
}

const CHANNEL = 'quant:alerts';

function getWhaleRedisUrl(): string {
  const rawUrl = process.env.WHALE_REDIS_URL;
  if (!rawUrl || rawUrl.trim() === '') {
    throw new Error(
      '[WhaleSubscriber] WHALE_REDIS_URL is not set. ' +
      'Add it to your .env file before starting the server. ' +
      'Example: WHALE_REDIS_URL=redis://default:<password>@<host>:6379'
    );
  }
  return rawUrl.replace(/^["']|["']$/g, '').trim();
}

// ── Singleton guards ──────────────────────────────────────────────────────────
const g = globalThis as typeof globalThis & {
  __whaleSubscriberInstance?: WhaleSubscriber;
  __whaleSubscriberWired?: boolean;
  __whaleSubscriberShutdownHooks?: boolean;
};

function registerWhaleSubscriberShutdownHooks(): void {
  if (g.__whaleSubscriberShutdownHooks) return;
  g.__whaleSubscriberShutdownHooks = true;
  const shutdown = async (sig: string) => {
    try {
      if (g.__whaleSubscriberInstance) {
        await g.__whaleSubscriberInstance.disconnect();
        console.log(`[WhaleSubscriber] ${sig} — Redis subscriber disconnected.`);
      }
    } catch (e) {
      console.warn('[WhaleSubscriber] disconnect error:', e instanceof Error ? e.message : e);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

export class WhaleSubscriber {
  private client: IORedis;

  constructor() {
    const url = getWhaleRedisUrl();

    this.client = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 10_000,
      retryStrategy(times) {
        if (times > 50) {
          console.error(
            `[WhaleSubscriber] Giving up after ${times} reconnect attempts. ` +
            'Check WHALE_REDIS_URL and remote firewall rules.'
          );
          return null;
        }
        const delay = Math.min(times * 300, 10_000);
        console.warn(`[WhaleSubscriber] Reconnect attempt #${times} — retrying in ${delay}ms`);
        return delay;
      },
    });

    this.client.on('connect', () =>
      console.log('[WhaleSubscriber] TCP connected → WHALE_REDIS_URL')
    );

    this.client.on('ready', () => {
      console.log(`[WhaleSubscriber] Connection ready — subscribing to "${CHANNEL}"`);
      this.client.subscribe(CHANNEL, (err, count) => {
        if (err) {
          console.error('[WhaleSubscriber] SUBSCRIBE error:', err.message);
        } else {
          console.log(`[WhaleSubscriber] Listening on ${count} channel(s): "${CHANNEL}"`);
        }
      });
    });

    this.client.on('error', (err) =>
      console.error('[WhaleSubscriber] Redis error:', err.message)
    );

    this.client.on('close', () =>
      console.warn('[WhaleSubscriber] Connection closed — waiting for retry...')
    );

    this.client.on('reconnecting', (ms: number) =>
      console.warn(`[WhaleSubscriber] Reconnecting in ${ms}ms`)
    );

    this.client.on('message', (channel, raw) => {
      if (channel !== CHANNEL) return;
      void this._dispatch(raw);
    });
  }

  /** Graceful shutdown. */
  async disconnect(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  /**
   * CHOKE POINT — the only thing that happens here is enqueueing.
   * No analysis. No AI calls. No DB writes. Just queue.add().
   */
  private async _dispatch(raw: string): Promise<void> {
    let alert: WhaleAlert;

    try {
      alert = JSON.parse(raw) as WhaleAlert;
    } catch {
      console.error('[WhaleSubscriber] Malformed JSON on quant:alerts — dropped:', raw);
      return;
    }

    // Minimal shape guard (full Zod validation happens inside the Orchestrator)
    if (!alert.symbol || alert.delta_pct === undefined) {
      console.warn('[WhaleSubscriber] Alert missing required fields — dropped:', alert);
      return;
    }

    // ── THE ONLY ACTION: enqueue into quantum-core-queue ──────────────────
    try {
      const { getQuantumCoreQueue } = await import('@/lib/queue/bullmq-setup');
      const queue = getQuantumCoreQueue();
      const jobId = `whale:${alert.symbol}:${alert.timestamp}`;

      await queue.add('process-whale', alert, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
      });

      console.log(
        `[WhaleSubscriber] ✓ Signal enqueued → quantum-core-queue: ` +
        `${alert.symbol} | ${alert.anomaly_type} | Δ${alert.delta_pct}%`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WhaleSubscriber] Failed to enqueue signal — signal lost:', msg);
    }
  }
}

/** Returns the process-wide singleton, creating it on first call. */
export function getWhaleSubscriber(): WhaleSubscriber {
  if (!g.__whaleSubscriberInstance) {
    g.__whaleSubscriberInstance = new WhaleSubscriber();
  }
  return g.__whaleSubscriberInstance;
}

/**
 * Wire the subscriber — idempotent.
 * Subsequent calls (e.g. from hot-reload) are no-ops because
 * `__whaleSubscriberWired` persists on `globalThis`.
 */
export function initWhaleSubscriber(): WhaleSubscriber {
  registerWhaleSubscriberShutdownHooks();
  const subscriber = getWhaleSubscriber();
  if (!g.__whaleSubscriberWired) {
    g.__whaleSubscriberWired = true;
    console.log('[WhaleSubscriber] Subscriber wired → quantum-core-queue (choke-point active).');
  }
  return subscriber;
}
