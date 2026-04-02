/**
 * Shared IORedis client for BullMQ.
 * Connects via REDIS_URL (TCP/TLS, e.g. rediss://default:token@host:port).
 * Upstash Redis provides this URL separately from the REST URL.
 * Falls back gracefully when REDIS_URL is absent so the Next.js build never hard-crashes.
 *
 * Two client types are exported:
 *   - getRedisClient()     → BullMQ worker client (maxRetriesPerRequest: null — retries indefinitely)
 *   - getHttpRedisClient() → HTTP route client    (maxRetriesPerRequest: 3   — fails fast for API handlers)
 *
 * IMPORTANT: Never use getRedisClient() in HTTP route handlers (API routes / Server Actions).
 * maxRetriesPerRequest: null will cause commands to hang indefinitely when Redis is unreachable,
 * blocking the request until the Vercel/Next.js function timeout kills it. Use getHttpRedisClient()
 * in all HTTP-facing code paths.
 */
import IORedis from 'ioredis';

let _client: IORedis | null = null;
let _httpClient: IORedis | null = null;

function createClient(redisUrl: string, label: string, maxRetriesPerRequest: number | null): IORedis {
  const client = new IORedis(redisUrl, {
    maxRetriesPerRequest,
    enableReadyCheck: false,
    connectTimeout: 10_000,
    tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    retryStrategy(times) {
      if (times > 30) {
        console.error(`[${label}] Giving up after ${times} reconnect attempts.`);
        return null;
      }
      const delay = Math.min(times * 200, 5_000);
      console.warn(`[${label}] Reconnect attempt #${times}, waiting ${delay}ms`);
      return delay;
    },
  });

  client.on('error', (err) => console.error(`[${label}] Connection error:`, err.message));
  client.on('ready', () => console.log(`[${label}] Connection established.`));

  return client;
}

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

  // maxRetriesPerRequest: null is required by BullMQ — workers must survive transient blips.
  _client = createClient(redisUrl, 'Redis/BullMQ', null);
  return _client;
}

/**
 * HTTP-safe Redis client for use in API route handlers and Server Actions.
 * Uses maxRetriesPerRequest: 3 so commands fail fast (throw) when Redis is
 * unreachable instead of hanging indefinitely like the BullMQ client.
 * Callers should wrap operations in try/catch and return a 503/500 response.
 *
 * Prefers WHALE_REDIS_URL (remote ingestion Redis) over REDIS_URL so that
 * HTTP handlers never accidentally connect to 127.0.0.1.
 */
export function getHttpRedisClient(): IORedis {
  if (_httpClient) return _httpClient;

  const redisUrl = getHttpRedisUrl();
  _httpClient = createClient(redisUrl, 'Redis/HTTP', 3);
  return _httpClient;
}

/** Graceful shutdown — call in PM2 SIGTERM handler. */
export async function closeRedisClient(): Promise<void> {
  await Promise.allSettled([
    _client ? _client.quit().catch(() => _client?.disconnect()) : Promise.resolve(),
    _httpClient ? _httpClient.quit().catch(() => _httpClient?.disconnect()) : Promise.resolve(),
  ]);
  _client = null;
  _httpClient = null;
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

/** BullMQ Redis URL — uses REDIS_URL only (local or dedicated queue broker). */
export function getRedisUrl(): string {
  return process.env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379';
}

/**
 * HTTP handler Redis URL — prefers WHALE_REDIS_URL (remote Germany ingestion
 * Redis) and falls back to REDIS_URL.  Never returns a bare localhost address
 * unless both env vars are explicitly set to one.
 */
export function getHttpRedisUrl(): string {
  const url = (process.env.WHALE_REDIS_URL || process.env.REDIS_URL)?.trim();
  if (!url) {
    throw new Error(
      '[Redis/HTTP] Neither WHALE_REDIS_URL nor REDIS_URL is set. ' +
      'Add one of these to your .env file.'
    );
  }
  return url;
}
