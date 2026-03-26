import { ANTHROPIC_MODEL_CANDIDATES } from '@/lib/anthropic-model';

const HEARTBEAT_MS = 8_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve('timeout');
      }
    );
  });
}

async function pingAnthropic(): Promise<boolean> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
  if (!apiKey) return false;

  for (const modelName of ANTHROPIC_MODEL_CANDIDATES) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply: OK' }],
      }),
      cache: 'no-store',
    });
    if (res.ok || res.status === 429) return true;
    if (res.status === 404) continue;
    return false;
  }
  return true;
}

async function pingGemini(): Promise<boolean> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey.includes('TODO')) return false;

  const model = 'gemini-1.5-flash-latest';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply: GEMINI_OK' }] }],
      }),
      cache: 'no-store',
    }
  );
  return res.ok;
}

export type AiProvidersHeartbeat = {
  gemini: boolean;
  anthropic: boolean;
  adminSecretValid: boolean;
  anyProviderOk: boolean;
};

/**
 * Lightweight live checks for Gemini + Anthropic (consensus stack).
 * Used by server actions — never exposes API keys.
 */
export async function runAiProvidersHeartbeat(): Promise<AiProvidersHeartbeat> {
  const adminSecretValid = Boolean((process.env.ADMIN_SECRET || '').trim());
  const [g, a] = await Promise.all([
    withTimeout(pingGemini(), HEARTBEAT_MS),
    withTimeout(pingAnthropic(), HEARTBEAT_MS),
  ]);
  const gemini = g === true;
  const anthropic = a === true;
  return {
    gemini,
    anthropic,
    adminSecretValid,
    anyProviderOk: adminSecretValid && (gemini || anthropic),
  };
}
