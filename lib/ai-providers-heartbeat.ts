import { ANTHROPIC_MODEL_CANDIDATES } from '@/lib/anthropic-model';
import { getLiveInfraHealth } from '@/lib/infra-health-probes';

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

export type AiProvidersHeartbeat = {
  gemini: boolean;
  anthropic: boolean;
  grok: boolean;
  /** i9 hardware feed via Redis quant:alerts → always true (sovereign pipeline). */
  internalPipelineActive: boolean;
  dbConnected: boolean;
  adminSecretValid: boolean;
  anyProviderOk: boolean;
};

/**
 * Lightweight live checks for Gemini + Anthropic (consensus stack).
 * Used by server actions — never exposes API keys.
 *
 * CryptoQuant and CoinMarketCap have been decommissioned. All market data
 * flows through the sovereign i9 hardware feed (Redis quant:alerts channel).
 */
export async function runAiProvidersHeartbeat(): Promise<AiProvidersHeartbeat> {
  const adminSecretValid = Boolean((process.env.ADMIN_SECRET || '').trim());
  const [infra, a] = await Promise.all([
    getLiveInfraHealth(),
    withTimeout(pingAnthropic(), HEARTBEAT_MS),
  ]);
  const gemini = infra.gemini;
  const dbConnected = infra.database === 'ok';
  const grok =
    infra.groq ||
    Boolean((process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim());
  const anthropic = a === true;
  const anyProviderWithKey = gemini || anthropic || grok;
  return {
    gemini,
    anthropic,
    grok,
    internalPipelineActive: true,
    dbConnected,
    adminSecretValid,
    anyProviderOk: dbConnected && anyProviderWithKey,
  };
}
