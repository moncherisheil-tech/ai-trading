import { NextResponse } from 'next/server';
import { getDbAsync } from '@/lib/db';

export async function GET() {
  const checks: Record<string, { ok: boolean; details?: string }> = {
    env_gemini: { ok: Boolean(process.env.GEMINI_API_KEY) },
    db: { ok: false },
  };

  try {
    await getDbAsync();
    checks.db = { ok: true };
  } catch (error: unknown) {
    checks.db = {
      ok: false,
      details: error instanceof Error ? error.message : 'Unknown DB error',
    };
  }

  const ok = Object.values(checks).every((check) => check.ok);
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
