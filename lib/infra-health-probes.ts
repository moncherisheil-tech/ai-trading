/**
 * Shared live probes for DB + AI (Telegram executive terminal, provider heartbeat).
 * Keeps checks lightweight and independent of `lib/db/sql.ts` pool lifecycle.
 *
 * RATE-LIMIT SAFETY: pingGeminiResolved() no longer fires a live generateContent request.
 * Sending real inference requests just to confirm key presence hammers the Gemini free-tier
 * quota (RPM limit), causing 429 → 60-second backoffs that propagate as 504s to the frontend.
 * Key presence + format validation is sufficient for a health/diagnostics context.
 */

import { Pool } from 'pg';
import {
  assertAuthorizedDatabaseUrl,
  normalizeDatabaseUrlEnv,
} from '@/lib/db/sovereign-db-url';

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

/**
 * Returns true when a non-placeholder GEMINI_API_KEY is present.
 *
 * Previously this fired a live generateContent request to confirm the key works. That approach
 * consumes RPM quota on every health check and, when rate-limited (429 with Retry-After: 60s),
 * caused cascading 504s on every page that calls getLiveInfraHealth(). Env-var presence is the
 * correct signal for "is this provider configured?"; actual inference health is validated by the
 * trading pipeline itself during normal operation.
 */
export function pingGeminiResolved(): boolean {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return Boolean(apiKey && apiKey.length >= 8 && !/todo|changeme|example/i.test(apiKey));
}

/**
 * Returns true when a non-placeholder GROQ_API_KEY is present.
 * Avoids a live /v1/models call to prevent Groq rate-limit cascades on health checks.
 */
export function pingGroqApi(): boolean {
  const key = process.env.GROQ_API_KEY?.trim();
  return Boolean(key && key.length >= 8 && !/todo|changeme|example/i.test(key));
}

export type LiveInfraHealth = {
  database: DatabaseProbeStatus;
  gemini: boolean;
  groq: boolean;
};

/**
 * Checks infrastructure health sequentially to avoid concurrent rate-limit storms.
 * DB probe is the only truly async operation; AI key checks are synchronous env reads.
 */
export async function getLiveInfraHealth(): Promise<LiveInfraHealth> {
  const url = process.env.DATABASE_URL;
  const database = await probePostgresSelect1(url || '');
  const gemini = pingGeminiResolved();
  const groq = pingGroqApi();
  return { database, gemini, groq };
}
