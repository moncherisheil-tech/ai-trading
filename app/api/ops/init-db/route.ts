/**
 * GET/POST /api/ops/init-db — Force DB initialization in production.
 * Creates required tables (including `telegram_subscribers`) when using PostgreSQL.
 *
 * Safe to call multiple times (CREATE TABLE IF NOT EXISTS).
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getAuthorizedToken } from '@/lib/cron-auth';
import { ensureNeuroPlasticityInitialized } from '@/lib/learning/recursive-optimizer';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const token = getAuthorizedToken(req);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await initDB();
  const neuro = await ensureNeuroPlasticityInitialized();
  return NextResponse.json({
    ok: true,
    message: 'DB init completed (idempotent).',
    neuroplasticity: {
      singletonCreated: neuro.created,
      syntheticMemoriesAdded: neuro.syntheticMemoriesAdded,
    },
  });
}

