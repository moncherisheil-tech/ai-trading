import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';

/** Required and optional env keys for parity with .env.example (validation at readiness). */
const ENV_KEYS = {
  required: ['GEMINI_API_KEY'] as const,
  optional: ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'PROXY_BINANCE_URL', 'UPSTASH_REDIS_REST_URL', 'ADMIN_LOGIN_PASSWORD', 'APP_SESSION_SECRET'] as const,
};

export async function GET() {
  const checks: Record<string, { ok: boolean; details?: string }> = {
    env_gemini: { ok: Boolean(process.env.GEMINI_API_KEY?.trim() && !/TODO/i.test(process.env.GEMINI_API_KEY)) },
    db: { ok: false },
  };

  for (const key of ENV_KEYS.optional) {
    const value = process.env[key];
    checks[`env_${key.toLowerCase()}`] = { ok: Boolean(value?.trim()) };
  }

  try {
    await getDbAsync();
    checks.db = { ok: true };
  } catch (error: unknown) {
    checks.db = {
      ok: false,
      details: error instanceof Error ? error.message : 'Unknown DB error',
    };
  }

  const ok = checks.env_gemini.ok && checks.db.ok;
  return NextResponse.json(
    {
      status: ok ? 'ready' : 'degraded',
      kind: 'ready',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: ok ? 200 : 503 }
  );
}
