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
