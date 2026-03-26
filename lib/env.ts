import 'dotenv/config';

const INVALID_KEY_MARKERS = ['TODO'];

function isInvalidKey(value: string | undefined): boolean {
  if (!value) return true;
  return INVALID_KEY_MARKERS.some((marker) => value.includes(marker));
}

export function getGeminiApiKey(): string {
  const serverKey = process.env.GEMINI_API_KEY?.trim();
  if (!isInvalidKey(serverKey)) {
    return serverKey as string;
  }

  throw new Error('Gemini API key is missing or invalid. Set GEMINI_API_KEY in your server environment.');
}

export function getOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!isInvalidKey(key)) {
    return key as string;
  }
  throw new Error('OpenAI API key is missing or invalid. Set OPENAI_API_KEY in your server environment.');
}

/** Optional Groq API key for Macro & Order Book agent (Llama 3). Returns undefined if missing/invalid. */
export function getGroqApiKey(): string | undefined {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key || typeof key !== 'string' || key.trim() === '' || isInvalidKey(key)) {
    return undefined;
  }
  return key.trim();
}

export function getRequiredGroqApiKey(): string {
  const key = getGroqApiKey();
  if (!key) {
    console.error('[CRITICAL] Grok/Groq API key missing during expert initialization. Expected GROQ_API_KEY.');
    throw new Error('Groq API key is missing or invalid. Set GROQ_API_KEY in your server environment.');
  }
  return key;
}

export function getRequiredAnthropicApiKey(): string {
  const key = (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key || isInvalidKey(key)) {
    console.error('[CRITICAL] Anthropic API key missing during expert initialization. Expected CLAUDE_API_KEY or ANTHROPIC_API_KEY.');
    throw new Error('Anthropic API key is missing or invalid. Set CLAUDE_API_KEY or ANTHROPIC_API_KEY.');
  }
  return key;
}
