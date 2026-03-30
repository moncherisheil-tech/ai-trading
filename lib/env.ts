const INVALID_KEY_MARKERS = ['TODO', 'your_', 'changeme', 'example', 'placeholder'];

/**
 * Strip wrapping quotes that some deployment tools (Docker ENV, PM2 ecosystem.config.js,
 * systemd EnvironmentFile, etc.) leave around env values when not using dotenv.
 */
function stripEnvQuotes(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function isInvalidKey(value: string | undefined): boolean {
  if (!value) return true;
  const lower = value.toLowerCase();
  return INVALID_KEY_MARKERS.some((marker) => lower.includes(marker));
}

export function getGeminiApiKey(): string {
  // Accept GEMINI_API_KEY or the generic GOOGLE_API_KEY alias used by some deploy platforms.
  const raw = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const serverKey = stripEnvQuotes(raw);
  if (!isInvalidKey(serverKey)) {
    return serverKey as string;
  }
  throw new Error('Gemini API key is missing or invalid. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in your server environment.');
}

export function getOpenAiApiKey(): string {
  const key = stripEnvQuotes(process.env.OPENAI_API_KEY);
  if (!isInvalidKey(key)) {
    return key as string;
  }
  throw new Error('OpenAI API key is missing or invalid. Set OPENAI_API_KEY in your server environment.');
}

/** Optional Groq API key for Macro & Order Book agent (Llama 3). Returns undefined if missing/invalid. */
export function getGroqApiKey(): string | undefined {
  const key = stripEnvQuotes(process.env.GROQ_API_KEY);
  if (!key || isInvalidKey(key)) return undefined;
  return key;
}

export function getRequiredGroqApiKey(): string {
  const key = getGroqApiKey();
  if (!key) {
    console.error('[CRITICAL] Groq API key missing during expert initialization. Expected GROQ_API_KEY.');
    throw new Error('Groq API key is missing or invalid. Set GROQ_API_KEY in your server environment.');
  }
  return key;
}

export function getRequiredAnthropicApiKey(): string {
  // Prefer the canonical ANTHROPIC_API_KEY; CLAUDE_API_KEY is the legacy alias.
  const raw = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const key = stripEnvQuotes(raw);
  if (!key || isInvalidKey(key)) {
    console.error('[CRITICAL] Anthropic API key missing during expert initialization. Expected ANTHROPIC_API_KEY (or legacy CLAUDE_API_KEY).');
    throw new Error('Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY in your server environment.');
  }
  return key;
}

/**
 * Returns the Pinecone index name from PINECONE_INDEX_NAME, or undefined if not configured.
 * Strips wrapping quotes that some deployment tools leave in env values.
 */
export function getPineconeIndexName(): string | undefined {
  const v = stripEnvQuotes(process.env.PINECONE_INDEX_NAME);
  if (!v || v.trim() === '') return undefined;
  return v.trim();
}

/**
 * Infrastructure pre-flight validation. Call once at process start (e.g., in instrumentation.ts
 * or the top-level layout/server entrypoint).
 *
 * Rules:
 *   - PINECONE_INDEX_NAME must NOT be purely numeric (e.g., "1002") — that is always wrong
 *     and will produce HTTP 404 from Pinecone. Throws a fatal Error to prevent silent failure.
 *   - REDIS_URL, if set, must not be a bare localhost URL in production (warning only).
 *
 * This function is safe to call multiple times (idempotent warn/throw logic).
 */
export function validateInfraEnv(): void {
  // ── Pinecone index name guard ─────────────────────────────────────────────
  const indexName = getPineconeIndexName();
  if (indexName !== undefined) {
    if (/^\d+$/.test(indexName)) {
      const msg =
        `[FATAL BOOT ERROR] PINECONE_INDEX_NAME="${indexName}" is invalid — ` +
        'index names cannot be purely numeric. A numeric value will always return HTTP 404 from Pinecone. ' +
        'Set PINECONE_INDEX_NAME to your actual index name (e.g., "quantum-memory").';
      console.error(msg);
      throw new Error(msg);
    }
    // Warn but don't throw for other suspicious patterns
    if (indexName.length < 3 || indexName.length > 64) {
      console.warn(
        `[env] PINECONE_INDEX_NAME="${indexName}" has an unusual length. ` +
        'Verify this matches an existing index in your Pinecone project.'
      );
    }
  }

  // ── Redis URL sanity check ────────────────────────────────────────────────
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl && /^redis:\/\/(127\.0\.0\.1|localhost)/i.test(redisUrl)) {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      console.warn(
        '[env] REDIS_URL appears to point to localhost in a production environment. ' +
        'Ensure this is intentional. For Upstash, use rediss:// TLS URL.'
      );
    }
  }
}
