/**
 * Whale Alert Redis Subscriber
 *
 * Maintains a dedicated IORedis subscriber client connected to the bare-metal
 * Rust ingestion engine's Redis instance (WHALE_REDIS_URL). Listens on the
 * `quant:alerts` channel and dispatches parsed payloads to registered handlers.
 *
 * Singleton pattern via `globalThis` ensures exactly one connection survives
 * Next.js hot-reload cycles in development.
 */
import IORedis from 'ioredis';

export interface WhaleAlert {
  symbol: string;
  anomaly_type: string;
  delta_pct: number;
  timestamp: string;
}

type AlertHandler = (alert: WhaleAlert) => Promise<void>;

const CHANNEL = 'quant:alerts';

function getWhaleRedisUrl(): string {
  // קורא מהסביבה או משתמש בכתובת המאובטחת כברירת מחדל
  const rawUrl = process.env.WHALE_REDIS_URL || 'redis://default:QuantumMonCheri2026!@88.99.208.99:6379';
  // מנקה אוטומטית מרכאות כפולות או יחידות שאולי עברו מקובץ ה-.env כדי למנוע שגיאות NOAUTH
  return rawUrl.replace(/^["']|["']$/g, '').trim();
}

// ── Singleton guards ──────────────────────────────────────────────────────────
// `globalThis` outlives module hot-reload in Next.js dev mode, preventing
// duplicate TCP connections to the remote Redis host on every file save.
const g = globalThis as typeof globalThis & {
  __whaleSubscriberInstance?: WhaleSubscriber;
  __whaleSubscriberWired?: boolean;
};

export class WhaleSubscriber {
  private client: IORedis;
  private handlers: AlertHandler[] = [];

  constructor() {
    const url = getWhaleRedisUrl();

    this.client = new IORedis(url, {
      // Subscriber clients must never time out individual commands.
      maxRetriesPerRequest: null,
      // Don't block process startup — reconnect logic handles the READY state.
      enableReadyCheck: false,
      connectTimeout: 10_000,
      // Exponential back-off, capped at 10 s. Give up after 50 attempts
      // (~8 min cumulative) so a permanently-down host doesn't silently
      // burn CPU. The Next.js process stays alive; only this subscriber stops.
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
      // מסתיר את הסיסמה בלוגים כדי לשמור על אבטחה
      console.log(`[WhaleSubscriber] TCP connected → redis://***@88.99.208.99:6379`)
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
      this._dispatch(raw);
    });
  }

  /** Register a handler that will be called for every validated alert. */
  addHandler(handler: AlertHandler): void {
    this.handlers.push(handler);
  }

  /** Graceful shutdown — call on SIGTERM / process exit. */
  async disconnect(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  private async _dispatch(raw: string): Promise<void> {
    let alert: WhaleAlert;
    try {
      alert = JSON.parse(raw) as WhaleAlert;
    } catch {
      console.error('[WhaleSubscriber] Malformed JSON on quant:alerts channel:', raw);
      return;
    }

    // Basic shape guard
    if (!alert.symbol || alert.delta_pct === undefined) {
      console.warn('[WhaleSubscriber] Alert payload missing required fields:', alert);
      return;
    }

    for (const handler of this.handlers) {
      try {
        await handler(alert);
      } catch (err) {
        console.error('[WhaleSubscriber] Handler threw:', err instanceof Error ? err.message : err);
      }
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
 * Wire the subscriber to the given alert handler — idempotent.
 * Subsequent calls (e.g. from hot-reload) are no-ops because the
 * `__whaleSubscriberWired` flag persists on `globalThis`.
 */
export function initWhaleSubscriber(handler: AlertHandler): WhaleSubscriber {
  const subscriber = getWhaleSubscriber();
  if (!g.__whaleSubscriberWired) {
    subscriber.addHandler(handler);
    g.__whaleSubscriberWired = true;
    console.log('[WhaleSubscriber] Alert handler registered.');
  }
  return subscriber;
}