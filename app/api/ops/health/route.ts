/**
 * GET /api/ops/health — API health status for Overseer panel (Gemini, Groq, Pinecone, DB).
 * Does not call external APIs to avoid rate limits; reports key presence and DB connectivity.
 * Requires admin when session enabled.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getAppSettings } from '@/lib/db/app-settings';
import { listOpenVirtualTrades } from '@/lib/db/virtual-portfolio';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return typeof v === 'string' && v.trim().length > 0;
}

export async function GET(): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const gemini = hasEnv('GEMINI_API_KEY') ? 'ok' : 'skip';
  const groq = hasEnv('GROQ_API_KEY') ? 'ok' : 'skip';

  const hasPineconeKey = hasEnv('PINECONE_API_KEY');
  const hasPineconeIndex = hasEnv('PINECONE_INDEX_NAME');
  const pinecone = hasPineconeKey && hasPineconeIndex ? 'ok' : 'skip';
  if (pinecone === 'skip') {
    if (!hasPineconeKey) {
      console.warn('[health] PINECONE_API_KEY is missing. Add it to .env to enable Pinecone vector DB.');
    }
    if (!hasPineconeIndex) {
      console.warn('[health] PINECONE_INDEX_NAME is missing. Add it to .env to enable Pinecone vector DB.');
    }
  }

  let db: 'ok' | 'fail' = 'fail';
  let virtualPortfolio: 'ok' | 'fail' | 'skip' = 'skip';
  try {
    await getAppSettings();
    db = 'ok';
  } catch {
    db = 'fail';
  }

  try {
    // Unified virtual trading storage health — verifies virtual_portfolio connectivity.
    await listOpenVirtualTrades();
    virtualPortfolio = 'ok';
  } catch {
    virtualPortfolio = 'fail';
  }

  return NextResponse.json({
    gemini,
    groq,
    pinecone,
    db,
    virtualPortfolio,
    timestamp: new Date().toISOString(),
  });
}
