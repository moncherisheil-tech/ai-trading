const INVALID_KEY_MARKERS = ['MY_GEMINI_API_KEY', 'MY_OPENAI_API_KEY', 'MY_GROQ_API_KEY', 'TODO'];

function isInvalidKey(value: string | undefined): boolean {
  if (!value) return true;
  return INVALID_KEY_MARKERS.some((marker) => value.includes(marker));
}

export function getGeminiApiKey(): string {
  const serverKey = process.env.GEMINI_API_KEY;
  if (!isInvalidKey(serverKey)) {
    return serverKey as string;
  }

  throw new Error('Gemini API key is missing or invalid. Set GEMINI_API_KEY in your server environment.');
}

export function getOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!isInvalidKey(key)) {
    return key as string;
  }
  throw new Error('OpenAI API key is missing or invalid. Set OPENAI_API_KEY in your server environment.');
}

/** Optional Groq API key for Macro & Order Book agent (Llama 3). Returns undefined if missing/invalid. */
export function getGroqApiKey(): string | undefined {
  const key = process.env.GROQ_API_KEY;
  if (!key || typeof key !== 'string' || key.trim() === '' || isInvalidKey(key)) {
    return undefined;
  }
  return key.trim();
}

export function getRequiredGroqApiKey(): string {
  const key = getGroqApiKey();
  if (!key) {
    throw new Error('Groq API key is missing or invalid. Set GROQ_API_KEY in your server environment.');
  }
  return key;
}
