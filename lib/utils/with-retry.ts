/**
 * Enterprise-Grade LLM Resilience & Observability Layer
 * 
 * Implements institutional-quality retry logic for LLM API calls:
 * - Exponential backoff with jitter (prevents Thundering Herd)
 * - Up to 3 retry attempts (configurable)
 * - Strict fallback flag tracking (is_fallback: true/false)
 * - Integrated observability logging
 * 
 * Architecture: All LLM calls wrap via withExponentialBackoff().
 * Fallback score (50) is ONLY returned when all retries exhausted OR API key missing.
 * Fallback flag ensures Overseer can exclude dead experts from weighted average.
 */

interface RetryConfig {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterRangeMs?: number;
}

interface RetryContext {
  symbol?: string;
  expert?: string;
  provider?: string;
}

/**
 * Determines if an error is retryable (transient, not permanent).
 * 429 (Rate Limit), 503 (Service Unavailable) → retryable
 * 401 (Unauthorized), 404 (Not Found) → NOT retryable
 */
export function isRetryableAiError(err: unknown): boolean {
  const anyErr = err as { status?: number; code?: number; message?: string };
  const status = anyErr?.status ?? anyErr?.code;
  const msg = (anyErr?.message || String(err || '')).toString();

  if (status === 429 || status === 503) return true;
  if (/rate limit|too many requests|unavailable|temporarily down|overloaded|timeout/i.test(msg)) {
    return true;
  }

  return false;
}

/**
 * Exponential backoff formula with jitter:
 * delay = 2^attempt * 1000ms + random(0, jitterRangeMs)
 * 
 * Example (3 retries):
 * - Attempt 1: 2^1 * 1000 + jitter = 2000ms + jitter
 * - Attempt 2: 2^2 * 1000 + jitter = 4000ms + jitter
 * - Attempt 3: 2^3 * 1000 + jitter = 8000ms + jitter
 * - Total max: ~14s
 */
function calculateBackoffMs(attempt: number, initialDelayMs: number = 1000, jitterRangeMs: number = 500): number {
  const exponential = Math.pow(2, attempt) * initialDelayMs;
  const jitter = Math.random() * jitterRangeMs;
  return exponential + jitter;
}

/**
 * Main retry wrapper for LLM API calls.
 * 
 * @param action - Async function that performs the LLM API call
 * @param config - Retry configuration (max attempts, delays, jitter)
 * @param ctx - Context for logging (symbol, expert, provider)
 * @returns Result of action() if successful within retries
 * @throws Error if all retries exhausted or error is not retryable
 * 
 * USAGE:
 * ```
 * try {
 *   const result = await withExponentialBackoff(
 *     () => callGeminiJson(...),
 *     { maxRetries: 3 },
 *     { symbol: 'BTCUSDT', expert: 'Technician', provider: 'Gemini' }
 *   );
 *   return { ...result, is_fallback: false };
 * } catch (err) {
 *   console.error('[Expert] Fallback engaged:', err);
 *   return { score: 50, logic: '...', is_fallback: true };
 * }
 * ```
 */
export async function withExponentialBackoff<T>(
  action: () => Promise<T>,
  config?: RetryConfig,
  ctx?: RetryContext
): Promise<T> {
  const maxRetries = config?.maxRetries ?? 3;
  const initialDelayMs = config?.initialDelayMs ?? 1000;
  const maxDelayMs = config?.maxDelayMs ?? 15000;
  const jitterRangeMs = config?.jitterRangeMs ?? 500;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const logSymbol = ctx?.symbol ?? 'N/A';
        const logExpert = ctx?.expert ?? 'unknown';
        const logProvider = ctx?.provider ?? 'unknown';
        console.warn(
          `[withExponentialBackoff] Retry attempt ${attempt}/${maxRetries} for symbol=${logSymbol} expert=${logExpert} provider=${logProvider}`
        );
      }

      return await action();
    } catch (err) {
      lastError = err;
      const retryable = isRetryableAiError(err);

      if (attempt >= maxRetries || !retryable) {
        throw err;
      }

      const backoffMs = Math.min(
        calculateBackoffMs(attempt, initialDelayMs, jitterRangeMs),
        maxDelayMs
      );

      console.warn(
        `[withExponentialBackoff] Error on attempt ${attempt}: ${err instanceof Error ? err.message : String(err)} | Backing off ${Math.round(backoffMs)}ms before retry ${attempt + 1}...`
      );

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError as Error;
}

/**
 * Wraps withExponentialBackoff for type-safe expert output handling.
 * 
 * Automatically attaches is_fallback flag:
 * - is_fallback: false on success
 * - is_fallback: true on fallback (all retries exhausted)
 * 
 * @param action - Async function that calls the LLM expert
 * @param fallback - Fallback object returned on failure (score: 50, logic: message)
 * @param config - Retry configuration
 * @param ctx - Context for logging
 * @returns Expert output with is_fallback flag
 * 
 * USAGE:
 * ```
 * const result = await withFallbackFlag(
 *   () => callGeminiJson<ExpertTechnicianOutput>(...),
 *   { tech_score: 50, tech_logic: 'Fallback engaged', is_fallback: true },
 *   { maxRetries: 3 },
 *   { symbol: 'BTCUSDT', expert: 'Technician' }
 * );
 * // result.is_fallback is automatically set based on success/failure
 * ```
 */
export async function withFallbackFlag<T extends { is_fallback?: boolean }>(
  action: () => Promise<T>,
  fallback: T,
  config?: RetryConfig,
  ctx?: RetryContext
): Promise<T> {
  try {
    const result = await withExponentialBackoff(action, config, ctx);
    return { ...result, is_fallback: false };
  } catch (err) {
    console.error(
      `[withFallbackFlag] All retries exhausted for ${ctx?.symbol ?? 'N/A'} (${ctx?.expert ?? 'unknown'}): ${err instanceof Error ? err.message : String(err)}`
    );
    return { ...fallback, is_fallback: true };
  }
}
