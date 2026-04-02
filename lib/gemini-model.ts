type GeminiRequestOptions = {
  /** Use v1beta endpoint for Flash model compatibility. */
  apiVersion: 'v1beta';
};

/** Default production Flash model for `@google/generative-ai` v1beta (2026). Locked — do not change without updating Pinecone embeddings. */
export const GEMINI_DEFAULT_FLASH_MODEL_ID = 'gemini-3-flash-preview' as const;

/**
 * Legacy / retired model IDs from env or old configs → canonical production Flash.
 */
const RETIRED_GEMINI_MODEL_IDS: Record<string, string> = {
  'gemini-1.5-flash': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-1.5-flash-8b': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-1.5-flash-latest': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-1.5-pro': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-1.5-pro-latest': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-pro': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-2.0-flash': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-2.0-flash-exp': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-3.0-flash-exp': 'gemini-3.1-pro-preview',
  'gemini-2.0-flash-thinking-exp': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-2.0-flash-lite': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-2.5-flash': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-2.5-flash-latest': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-2.5-flash-preview': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-2.5-pro': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-2.5-pro-latest': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-2.5-pro-preview': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-3-pro-preview': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-exp-1206': GEMINI_DEFAULT_FLASH_MODEL_ID,
  'gemini-3-flash-preview': GEMINI_DEFAULT_FLASH_MODEL_ID,
};

export function normalizeGeminiModelId(modelName: string): string {
  const stripped = (modelName || '').replace(/^models\//, '').trim();
  const id = stripped || GEMINI_DEFAULT_FLASH_MODEL_ID;
  return RETIRED_GEMINI_MODEL_IDS[id] ?? id;
}

export function resolveGeminiModel(modelName: string): {
  model: string;
  requestOptions: GeminiRequestOptions;
} {
  const normalized = normalizeGeminiModelId(modelName || GEMINI_DEFAULT_FLASH_MODEL_ID);
  const model = `models/${normalized}`;

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
      const base = baseDelayMs * 2 ** attempt;
      // True random jitter (0–15%) prevents synchronized retry storms across concurrent callers
      const jitter = Math.floor(Math.random() * Math.max(500, base * 0.15));
      await sleepMs(base + jitter);
    }
  }
  throw lastErr;
}
