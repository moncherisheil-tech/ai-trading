/**
 * Shared live probes for DB + AI (Telegram executive terminal, provider heartbeat).
 * Keeps checks lightweight and independent of `lib/db/sql.ts` pool lifecycle.
 */

import { Pool } from 'pg';
import {
  assertAuthorizedDatabaseUrl,
  normalizeDatabaseUrlEnv,
} from '@/lib/db/sovereign-db-url';
import { GEMINI_DEFAULT_FLASH_MODEL_ID, resolveGeminiModel } from '@/lib/gemini-model';

const PROBE_MS = 6_000;

export type DatabaseProbeStatus = 'ok' | 'misconfigured' | 'unreachable' | 'absent';

export async function probePostgresSelect1(url: string): Promise<DatabaseProbeStatus> {
  const trimmed = normalizeDatabaseUrlEnv(url);
  if (!trimmed) return 'absent';
  try {
    assertAuthorizedDatabaseUrl(trimmed);
  } catch {
    return 'misconfigured';
  }
  const pool = new Pool({
    connectionString: trimmed,
    max: 1,
    connectionTimeoutMillis: PROBE_MS,
  });
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('probe_timeout')), PROBE_MS)
      ),
    ]);
    return 'ok';
  } catch {
    return 'unreachable';
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function pingGeminiResolved(): Promise<boolean> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || /todo|changeme|example/i.test(apiKey)) return false;
  const id = resolveGeminiModel(GEMINI_DEFAULT_FLASH_MODEL_ID).model.replace(/^models\//, '');
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply: OK' }] }],
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(PROBE_MS),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function pingGroqApi(): Promise<boolean> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return false;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type LiveInfraHealth = {
  database: DatabaseProbeStatus;
  gemini: boolean;
  groq: boolean;
};

export async function getLiveInfraHealth(): Promise<LiveInfraHealth> {
  const url = process.env.DATABASE_URL;
  const [database, gemini, groq] = await Promise.all([
    probePostgresSelect1(url || ''),
    pingGeminiResolved(),
    pingGroqApi(),
  ]);
  return { database, gemini, groq };
}
