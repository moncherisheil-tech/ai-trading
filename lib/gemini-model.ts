type GeminiRequestOptions = {
  /** Use v1beta endpoint for Flash model compatibility. */
  apiVersion: 'v1beta';
};

export function resolveGeminiModel(modelName: string): {
  model: string;
  requestOptions: GeminiRequestOptions;
} {
  void modelName;
  const model = 'models/gemini-1.5-flash';

  return {
    model,
    requestOptions: { apiVersion: 'v1beta' },
  };
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Detects Gemini / Google AI 429 quota exhaustion across SDK errors and fetch responses.
 */
export function isGeminiRateLimitError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const o = err as { status?: number; statusCode?: number; code?: number; message?: string };
    const code = o.status ?? o.statusCode ?? o.code;
    if (code === 429) return true;
    const msg = typeof o.message === 'string' ? o.message : '';
    if (/429|resource_exhausted|rate limit|quota|too many requests/i.test(msg)) return true;
  }
  if (typeof err === 'string' && /429|resource_exhausted|quota/i.test(err)) return true;
  return false;
}

type RateLimitRetryOptions = {
  /** Max attempts including the first try. */
  maxAttempts?: number;
  /** First backoff after a 429 (ms). Subsequent waits double (exponential). */
  baseDelayMs?: number;
};

/**
 * On 429: wait `baseDelayMs`, then retry; delays follow 10s, 20s, 40s, … when baseDelayMs=10_000.
 */
export async function withGeminiRateLimitRetry<T>(
  operation: () => Promise<T>,
  options?: RateLimitRetryOptions
): Promise<T> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 6);
  const baseDelayMs = options?.baseDelayMs ?? 10_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      const retryable = isGeminiRateLimitError(err);
      if (!retryable || attempt === maxAttempts - 1) {
        throw err;
      }
      const delay = baseDelayMs * 2 ** attempt;
      await sleepMs(delay);
    }
  }
  throw lastErr;
}
