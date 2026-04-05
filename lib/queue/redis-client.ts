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
 *
 * AUTH: On WRONGPASS / NOAUTH, logs `[AUTH_ERROR]` and stops the reconnect loop (no infinite spin).
 */
import IORedis, { type RedisOptions } from 'ioredis';
import {
  getResolvedHttpRedisUrl,
  getResolvedRedisUrl,
} from '@/lib/config';

let _client: IORedis | null = null;
let _httpClient: IORedis | null = null;

/** True when Redis rejected credentials — reconnect loop must not spin forever. */
export function isRedisFatalAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  return (
    msg.includes('WRONGPASS') ||
    msg.includes('NOAUTH') ||
    msg.includes('INVALID USERNAME-PASSWORD') ||
    msg.includes('AUTHENTICATION REQUIRED') ||
    msg.includes('ERR AUTH') ||
    msg.includes('DENIED BY ACL')
  );
}

export function tlsOptionsForRedisUrl(redisUrl: string): RedisOptions['tls'] {
  return redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined;
}

type CreateClientOptions = {
  /** Max reconnect attempts before giving up (null = unlimited until fatal auth). */
  reconnectCap?: number;
};

/**
 * Long-lived IORedis (subscriber / custom use) with auth-aware reconnect cap.
 * BullMQ worker should use getRedisClient() instead.
 */
export function createLongLivedRedisClient(
  redisUrl: string,
  label: string,
  maxRetriesPerRequest: number | null,
  reconnectCap = 30
): IORedis {
  return createClient(redisUrl, label, maxRetriesPerRequest, { reconnectCap });
}

function createClient(
  redisUrl: string,
  label: string,
  maxRetriesPerRequest: number | null,
  options?: CreateClientOptions
): IORedis {
  const reconnectCap = options?.reconnectCap ?? 30;
  const state = { fatalAuth: false };

  const client = new IORedis(redisUrl, {
    maxRetriesPerRequest,
    enableReadyCheck: false,
    connectTimeout: 10_000,
    tls: tlsOptionsForRedisUrl(redisUrl),
    retryStrategy(times) {
      if (state.fatalAuth) {
        console.error(
          `[${label}] [AUTH_ERROR] Reconnect aborted — fix Redis password / ACL or use correct TLS (rediss://).`
        );
        return null;
      }
      if (times > reconnectCap) {
        console.error(`[${label}] Giving up after ${times} reconnect attempts.`);
        return null;
      }
      const delay = Math.min(times * 200, 5_000);
      console.warn(`[${label}] Reconnect attempt #${times}, waiting ${delay}ms`);
      return delay;
    },
  });

  client.on('error', (err) => {
    if (isRedisFatalAuthError(err)) {
      state.fatalAuth = true;
      console.error(
        `[${label}] [AUTH_ERROR] Redis authentication failed — update REDIS_URL or WHALE_REDIS_URL ` +
        `(password, username, TLS). Message: ${err.message}`
      );
      client.disconnect();
    } else {
      console.error(`[${label}] Connection error:`, err.message);
    }
  });
  client.on('ready', () => console.log(`[${label}] Connection established.`));

  return client;
}

export function getRedisClient(): IORedis {
  if (_client) return _client;

  const redisUrl = getRedisUrl();

  if (!(process.env.REDIS_URL || '').trim()) {
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

/** BullMQ Redis URL — resolved via lib/config.ts (not raw process.env). */
export function getRedisUrl(): string {
  return getResolvedRedisUrl();
}

/**
 * HTTP handler Redis URL — prefers WHALE_REDIS_URL (remote Germany ingestion
 * Redis) and falls back to REDIS_URL.  Never returns a bare localhost address
 * unless both env vars are explicitly set to one.
 */
export function getHttpRedisUrl(): string {
  return getResolvedHttpRedisUrl();
}
