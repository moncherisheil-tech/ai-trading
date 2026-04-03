import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';

/** Required and optional env keys for parity with .env.example (validation at readiness). */
const ENV_KEYS = {
  required: ['GEMINI_API_KEY'] as const,
  optional: [
    'DATABASE_URL',
    'REDIS_URL',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'PROXY_BINANCE_URL',
    'UPSTASH_REDIS_REST_URL',
    'ADMIN_LOGIN_PASSWORD',
    'APP_SESSION_SECRET',
  ] as const,
};

type CheckResult = { ok: boolean; latencyMs?: number; details?: string };

/** Pings the Binance REST depth endpoint — public, no auth required. */
async function checkBinance(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.binance.com/api/v3/ping', {
      signal: AbortSignal.timeout(4_000),
      cache: 'no-store',
    });
    return { ok: res.ok, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, details: e instanceof Error ? e.message : String(e) };
  }
}

/** Pings Redis via IORedis — creates a one-off connection and immediately quits. */
async function checkRedis(): Promise<CheckResult> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return { ok: false, details: 'REDIS_URL not configured' };
  const t0 = Date.now();
  try {
    const { default: IORedis } = await import('ioredis');
    const client = new IORedis(url, {
      connectTimeout: 3_000,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
    });
    await client.connect();
    const pong = await client.ping();
    await client.quit();
    return { ok: pong === 'PONG', latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, details: e instanceof Error ? e.message : String(e) };
  }
}

/** Light Postgres check — just calls getDbAsync() which validates the pool. */
async function checkPostgres(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    await getDbAsync();
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, details: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const checks: Record<string, CheckResult> = {
    env_gemini: { ok: Boolean(process.env.GEMINI_API_KEY?.trim() && !/TODO/i.test(process.env.GEMINI_API_KEY)) },
  };

  for (const key of ENV_KEYS.optional) {
    checks[`env_${key.toLowerCase()}`] = { ok: Boolean(process.env[key]?.trim()) };
  }

  // Run all I/O checks in parallel with individual error isolation
  const [pgResult, redisResult, binanceResult] = await Promise.allSettled([
    checkPostgres(),
    checkRedis(),
    checkBinance(),
  ]);

  checks.postgres = pgResult.status === 'fulfilled' ? pgResult.value : { ok: false, details: String(pgResult.reason) };
  checks.redis = redisResult.status === 'fulfilled' ? redisResult.value : { ok: false, details: String(redisResult.reason) };
  checks.binance = binanceResult.status === 'fulfilled' ? binanceResult.value : { ok: false, details: String(binanceResult.reason) };

  // System is "ready" when the required AI key is present; external services
  // are reported but do not block readiness (they degrade gracefully).
  const coreReady = checks.env_gemini.ok;
  const allHealthy = coreReady && checks.postgres.ok && checks.redis.ok && checks.binance.ok;

  return NextResponse.json(
    {
      status: allHealthy ? 'ready' : coreReady ? 'degraded' : 'not_ready',
      kind: 'ready',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allHealthy ? 200 : coreReady ? 200 : 503 }
  );
}
