console.log(">>> SYSTEM BOOTING: VERSION 2026.03.31-FORCE-HEAL <<<");

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
 * Infrastructure pre-flight validation. Call once at process start (instrumentation.ts
 * and queue-worker.ts). Throws on fatal misconfiguration; warns on recoverable issues.
 *
 * Validation rules enforced here:
 *   1. PINECONE_INDEX_NAME — must NOT be purely numeric; must be a valid alphanumeric slug.
 *   2. PINECONE_DIMENSION  — must equal "768" when set (model output dimension).
 *      Accepts both PINECONE_EMBEDDING_DIM and PINECONE_DIMENSION variable names.
 *   3. REDIS_URL           — must be set in production and must equal
 *      redis://127.0.0.1:6379 for this on-prem deployment.
 *   4. Core secrets        — DATABASE_URL, APP_SESSION_SECRET, TELEGRAM_BOT_TOKEN
 *      must all be present and non-empty.
 *
 * This function is safe to call multiple times (idempotent warn/throw logic).
 */
export function validateInfraEnv(): void {
  const isProduction = process.env.NODE_ENV === 'production';

  // ── 1. Pinecone index name guard ──────────────────────────────────────────
  const indexName = getPineconeIndexName();
  if (indexName !== undefined) {
    if (/^\d+$/.test(indexName)) {
      console.warn(
        `[AUTO-RECOVERY] Invalid Pinecone Index Name ("${indexName}") detected. ` +
        'Forcing override to "quantum-memory".'
      );
      process.env.PINECONE_INDEX_NAME = 'quantum-memory';
    }
    // Must only contain alphanumerics and hyphens (Pinecone naming rules)
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i.test(indexName)) {
      console.warn(
        `[env] PINECONE_INDEX_NAME="${indexName}" contains characters that may be rejected by Pinecone. ` +
        'Expected format: lowercase alphanumeric with optional hyphens (e.g., "quantum-memory").'
      );
    }
    if (indexName.length < 3 || indexName.length > 64) {
      console.warn(
        `[env] PINECONE_INDEX_NAME="${indexName}" has an unusual length. ` +
        'Verify this matches an existing index in your Pinecone project.'
      );
    }
  }

  // ── 2. Pinecone dimension guard (model output must be 768) ────────────────
  // Accepts either PINECONE_EMBEDDING_DIM (legacy) or PINECONE_DIMENSION.
  const rawDim =
    stripEnvQuotes(process.env.PINECONE_EMBEDDING_DIM) ??
    stripEnvQuotes(process.env.PINECONE_DIMENSION);
  if (rawDim && rawDim.trim() !== '') {
    const parsed = Number(rawDim.trim());
    if (!Number.isFinite(parsed)) {
      const msg =
        `[FATAL BOOT ERROR] PINECONE_EMBEDDING_DIM="${rawDim}" is not a valid number. ` +
        'Set it to 768 to match the Gemini text-embedding-004 model output.';
      console.error(msg);
      throw new Error(msg);
    }
    if (parsed !== 768) {
      const msg =
        `[FATAL BOOT ERROR] PINECONE_EMBEDDING_DIM=${parsed} does not match ` +
        'the required model output dimension of 768 (Gemini text-embedding-004). ' +
        'Uploading vectors with the wrong dimension will fail with a Pinecone 400 error. ' +
        'Fix PINECONE_EMBEDDING_DIM=768 in your .env file.';
      console.error(msg);
      throw new Error(msg);
    }
  }

  // ── 3. Redis URL enforcement ───────────────────────────────────────────────
  // On-prem deployment: Redis should be reachable at 127.0.0.1:6379.
  // The Redis client (`lib/queue/redis-client.ts`) always falls back to
  // redis://127.0.0.1:6379, so a missing REDIS_URL env var is non-fatal —
  // we only warn so the operator knows to set it explicitly.
  const REDIS_FALLBACK = 'redis://127.0.0.1:6379';
  const redisUrl = stripEnvQuotes(process.env.REDIS_URL)?.trim() || REDIS_FALLBACK;
  if (!stripEnvQuotes(process.env.REDIS_URL)?.trim()) {
    console.warn(
      `[env] REDIS_URL is not set — using hardcoded fallback "${REDIS_FALLBACK}". ` +
      'Set REDIS_URL=redis://127.0.0.1:6379 in your .env file to eliminate this warning.'
    );
  } else {
    const expected = REDIS_FALLBACK;
    if (redisUrl !== expected) {
      console.warn(
        `[env] REDIS_URL="${redisUrl}" differs from the expected on-prem value "${expected}". ` +
        'If intentional (e.g., Upstash TLS), disregard this warning. ' +
        'Otherwise update REDIS_URL in .env to match the local Redis instance.'
      );
    }
  }

  // ── 4. Core secrets presence check ────────────────────────────────────────
  const requiredSecrets: Array<{ key: string; hint: string }> = [
    { key: 'DATABASE_URL',       hint: 'Neon / local PostgreSQL connection string' },
    { key: 'APP_SESSION_SECRET', hint: 'session signing key — generate with: openssl rand -hex 32' },
    { key: 'TELEGRAM_BOT_TOKEN', hint: 'BotFather token — required for alerts and trade notifications' },
  ];
  for (const { key, hint } of requiredSecrets) {
    const val = stripEnvQuotes(process.env[key]);
    if (!val || val.trim() === '' || isInvalidKey(val)) {
      const msg =
        `[FATAL BOOT ERROR] Required secret ${key} is missing or contains a placeholder value. ` +
        `(${hint}) — set it in your .env file before starting the server.`;
      console.error(msg);
      throw new Error(msg);
    }
  }
}
