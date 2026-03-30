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

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  if (!process.env.REDIS_URL) {
    console.warn(
      '[Redis] REDIS_URL is not set. Falling back to redis://127.0.0.1:6379. ' +
      'Set REDIS_URL in your environment for production use.'
    );
  }

  _client = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    retryStrategy(times) {
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

/** True when REDIS_URL is set and the client can be instantiated. */
export function isRedisAvailable(): boolean {
  return Boolean(process.env.REDIS_URL);
}
