const INVALID_KEY_MARKERS = ['MY_GEMINI_API_KEY', 'TODO'];

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
