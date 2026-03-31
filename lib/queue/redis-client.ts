/**
 * Shared IORedis client for BullMQ.
 * Connects via REDIS_URL (TCP/TLS, e.g. rediss://default:token@host:port).
 * Upstash Redis provides this URL separately from the REST URL.
 * Falls back gracefully when REDIS_URL is absent so the Next.js build never hard-crashes.
 */
import IORedis from 'ioredis';

let _client: IORedis | null = null;

export function getRedisClient(): IORedis {
  if (_client) return _client;

  const redisUrl = getRedisUrl();

  if (!process.env.REDIS_URL) {
    console.warn(
      '[Redis] REDIS_URL is not set — using hardcoded fallback redis://127.0.0.1:6379. ' +
      'Set REDIS_URL=redis://127.0.0.1:6379 in your .env file to silence this warning.'
    );
  } else {
    console.log(`[Redis] Using REDIS_URL from environment: ${redisUrl.replace(/:\/\/[^@]+@/, '://***@')}`);
  }

  _client = new IORedis(redisUrl, {
    // BullMQ requirement: never time out individual commands — the worker must
    // survive transient Redis blips without throwing "Command timed out" errors.
    maxRetriesPerRequest: null,
    // Do not block process startup waiting for Redis to confirm READY.
    // The retryStrategy below handles reconnection transparently.
    enableReadyCheck: false,
    // Hard deadline for the TCP handshake itself. Without this, a completely
    // unreachable Redis host causes the client to hang forever at deploy time.
    connectTimeout: 10_000,
    tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    // Exponential back-off capped at 5 s; returning null (after 30 attempts ≈
    // 2.5 min of cumulative wait) stops retrying and lets the process surface
    // the error so PM2 can log it and decide whether to restart the worker.
    retryStrategy(times) {
      if (times > 30) {
        console.error(`[Redis] Giving up after ${times} reconnect attempts. PM2 will restart the worker.`);
        return null;
      }
      const delay = Math.min(times * 200, 5_000);
      console.warn(`[Redis] Reconnect attempt #${times}, waiting ${delay}ms`);
      return delay;
    },
  });

  _client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  _client.on('ready', () => {
    console.log('[Redis] Connection established.');
  });

  return _client;
}

/** Graceful shutdown — call in PM2 SIGTERM handler. */
export async function closeRedisClient(): Promise<void> {
  if (_client) {
    await _client.quit().catch(() => _client?.disconnect());
    _client = null;
  }
}

/**
 * True when the Redis client can be instantiated.
 *
 * Always returns `true` because `getRedisClient()` falls back to
 * `redis://127.0.0.1:6379` when REDIS_URL is absent — the connection
 * will succeed on any server where Redis is running locally.
 * Queue features are gated on a real PING (see `waitForRedisReady()`),
 * not on the presence of an env variable.
 */
export function isRedisAvailable(): boolean {
  return true;
}

/** Effective Redis URL — env value or the hardcoded on-prem fallback. */
export function getRedisUrl(): string {
  return process.env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379';
}
