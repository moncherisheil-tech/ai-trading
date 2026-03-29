/**
 * Redis-backed Circuit Breaker for LLM endpoints.
 *
 * States (stored in Redis, cluster-safe):
 *   CLOSED   → normal operation, counting failures in a sliding window
 *   OPEN     → primary endpoint failed too many times; route to fallback
 *   HALF_OPEN → recovery probe: one test request allowed through
 *
 * Key schema:
 *   cb:{endpoint}:state      → "CLOSED" | "OPEN" | "HALF_OPEN"
 *   cb:{endpoint}:failures   → integer (INCR with TTL = failure window)
 *   cb:{endpoint}:opened_at  → epoch ms
 */

import { getRedisClient, isRedisAvailable } from './redis-client';

export type CbEndpoint = 'groq' | 'anthropic' | 'gemini';
export type CbState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const FAILURE_THRESHOLD = Number(process.env.CB_FAILURE_THRESHOLD ?? 5);
const FAILURE_WINDOW_S = Number(process.env.CB_FAILURE_WINDOW_S ?? 60);
const RECOVERY_MS = Number(process.env.CB_RECOVERY_MS ?? 300_000); // 5 min

/** Fallback endpoint for each primary when its breaker is OPEN. */
const FALLBACK_MAP: Record<CbEndpoint, CbEndpoint> = {
  anthropic: 'gemini',
  groq: 'gemini',
  gemini: 'groq',
};

function stateKey(ep: CbEndpoint) { return `cb:${ep}:state`; }
function failureKey(ep: CbEndpoint) { return `cb:${ep}:failures`; }
function openedKey(ep: CbEndpoint) { return `cb:${ep}:opened_at`; }

async function getState(ep: CbEndpoint): Promise<CbState> {
  if (!isRedisAvailable()) return 'CLOSED';
  const r = getRedisClient();
  const raw = await r.get(stateKey(ep));
  return (raw as CbState | null) ?? 'CLOSED';
}

async function setState(ep: CbEndpoint, state: CbState): Promise<void> {
  if (!isRedisAvailable()) return;
  const r = getRedisClient();
  await r.set(stateKey(ep), state);
}

async function incrementFailures(ep: CbEndpoint): Promise<number> {
  if (!isRedisAvailable()) return 0;
  const r = getRedisClient();
  const key = failureKey(ep);
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, FAILURE_WINDOW_S);
  return count;
}

async function resetFailures(ep: CbEndpoint): Promise<void> {
  if (!isRedisAvailable()) return;
  const r = getRedisClient();
  await r.del(failureKey(ep));
}

async function recordOpen(ep: CbEndpoint): Promise<void> {
  if (!isRedisAvailable()) return;
  const r = getRedisClient();
  await r.set(openedKey(ep), Date.now().toString());
}

async function getOpenedAt(ep: CbEndpoint): Promise<number | null> {
  if (!isRedisAvailable()) return null;
  const r = getRedisClient();
  const val = await r.get(openedKey(ep));
  return val ? Number(val) : null;
}

/**
 * Execute `primary` protected by the circuit breaker.
 * When the breaker is OPEN or `primary` throws, `fallback` is called instead.
 * HTTP 429 errors are recorded but do NOT increment the circuit-failure counter
 * (they are handled by BullMQ job-level exponential backoff instead).
 */
export async function withCircuitBreaker<T>(
  endpoint: CbEndpoint,
  primary: () => Promise<T>,
  fallback: () => Promise<T>
): Promise<T> {
  const state = await getState(endpoint);

  if (state === 'OPEN') {
    const openedAt = await getOpenedAt(endpoint);
    const elapsed = openedAt ? Date.now() - openedAt : Infinity;
    if (elapsed >= RECOVERY_MS) {
      await setState(endpoint, 'HALF_OPEN');
      console.warn(`[CB:${endpoint}] HALF_OPEN — probing primary.`);
    } else {
      const fallbackEp = FALLBACK_MAP[endpoint];
      console.warn(`[CB:${endpoint}] OPEN — routing to ${fallbackEp} fallback.`);
      return fallback();
    }
  }

  try {
    const result = await primary();
    if (state === 'HALF_OPEN') {
      await setState(endpoint, 'CLOSED');
      await resetFailures(endpoint);
      console.log(`[CB:${endpoint}] Recovered → CLOSED.`);
    }
    return result;
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status ??
                   (err as { statusCode?: number })?.statusCode;
    const is429 = status === 429;

    if (!is429) {
      const failures = await incrementFailures(endpoint);
      console.warn(`[CB:${endpoint}] Failure #${failures}/${FAILURE_THRESHOLD}.`);

      if (failures >= FAILURE_THRESHOLD || state === 'HALF_OPEN') {
        await setState(endpoint, 'OPEN');
        await recordOpen(endpoint);
        await resetFailures(endpoint);
        console.error(`[CB:${endpoint}] → OPEN. Routing all traffic to fallback.`);
      }
    }

    return fallback();
  }
}

/** Read all circuit breaker states for the status API. */
export async function getAllCircuitBreakerStates(): Promise<Record<CbEndpoint, CbState>> {
  const endpoints: CbEndpoint[] = ['groq', 'anthropic', 'gemini'];
  const states = await Promise.all(endpoints.map(getState));
  return Object.fromEntries(endpoints.map((ep, i) => [ep, states[i]])) as Record<CbEndpoint, CbState>;
}

/** Force-reset a breaker (admin use). */
export async function resetCircuitBreaker(endpoint: CbEndpoint): Promise<void> {
  await setState(endpoint, 'CLOSED');
  await resetFailures(endpoint);
  if (isRedisAvailable()) {
    await getRedisClient().del(openedKey(endpoint));
  }
  console.log(`[CB:${endpoint}] Manually reset → CLOSED.`);
}
