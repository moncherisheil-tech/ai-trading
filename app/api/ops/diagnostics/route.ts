/**
 * GET /api/ops/diagnostics — Internal diagnostics for admin dashboard.
 * Returns: connection status (Gemini, Groq, Pinecone, Postgres), latest consensus save, last Pinecone upsert.
 * Requires admin when session enabled.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getDbAsync } from '@/lib/db';
import { getLastPineconeUpsertAt } from '@/lib/db/ops-metadata';
import { getAppSettings } from '@/lib/db/app-settings';
import { listOpenVirtualTrades } from '@/lib/db/virtual-portfolio';
import { verifyPineconeConnectionStrict } from '@/lib/vector-db';
import { fetchMacroContext } from '@/lib/api-utils';

export const dynamic = 'force-dynamic';

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return typeof v === 'string' && v.trim().length > 0;
}

export async function GET(): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get('app_auth_token')?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const geminiKey = hasEnv('GEMINI_API_KEY');
  const groqKey = hasEnv('GROQ_API_KEY');
  const pineconeKey = hasEnv('PINECONE_API_KEY');
  const pineconeIndex = hasEnv('PINECONE_INDEX_NAME');

  let gemini: 'ok' | 'fail' | 'skip' = geminiKey ? 'ok' : 'skip';
  let groq: 'ok' | 'fail' | 'skip' = groqKey ? 'ok' : 'skip';
  let pinecone: 'ok' | 'fail' | 'skip' = pineconeKey && pineconeIndex ? 'ok' : 'skip';
  let postgres: 'ok' | 'fail' = 'fail';

  try {
    await getAppSettings();
    await listOpenVirtualTrades();
    postgres = 'ok';
  } catch {
    postgres = 'fail';
  }

  if (pinecone === 'ok') {
    const connection = await verifyPineconeConnectionStrict();
    if (!connection.ok) {
      pinecone = 'fail';
    }
  }

  let latestConsensus: { saved: boolean; prediction_date: string | null; symbol?: string } = {
    saved: false,
    prediction_date: null,
  };
  try {
    const records = await getDbAsync();
    const withConsensus = records.filter(
      (r) => r.master_insight_he != null && r.final_confidence != null
    );
    const latest = withConsensus.sort(
      (a, b) => new Date(b.prediction_date).getTime() - new Date(a.prediction_date).getTime()
    )[0];
    if (latest) {
      latestConsensus = {
        saved: true,
        prediction_date: latest.prediction_date,
        symbol: latest.symbol,
      };
    }
  } catch {
    latestConsensus = { saved: false, prediction_date: null };
  }

  let lastPineconeUpsert: string | null = null;
  try {
    lastPineconeUpsert = await getLastPineconeUpsertAt();
  } catch {
    // ignore
  }

  let macroDxy: {
    status: 'ok' | 'fail';
    value: number | null;
    source: string | null;
    note: string;
    updatedAt: string | null;
  } = {
    status: 'fail',
    value: null,
    source: null,
    note: 'DXY diagnostics unavailable.',
    updatedAt: null,
  };

  try {
    const macro = await fetchMacroContext();
    macroDxy = {
      status: macro.dxyStatus ?? (typeof macro.dxyValue === 'number' ? 'ok' : 'fail'),
      value: typeof macro.dxyValue === 'number' ? macro.dxyValue : null,
      source: macro.dxySource ?? null,
      note: macro.dxyNote,
      updatedAt: macro.updatedAt ?? null,
    };
  } catch {
    // keep fail defaults
  }

  return NextResponse.json({
    connections: {
      gemini,
      groq,
      pinecone,
      postgres,
    },
    systemIntegrity: {
      latestConsensusSaved: latestConsensus.saved,
      latestConsensusPredictionDate: latestConsensus.prediction_date,
      latestConsensusSymbol: latestConsensus.symbol ?? null,
    },
    deepMemorySync: {
      lastPineconeUpsertAt: lastPineconeUpsert,
      pineconeIndex: pineconeIndex ? process.env.PINECONE_INDEX_NAME ?? null : null,
      pineconeConfigured: pineconeKey && pineconeIndex,
    },
    macroHealth: {
      dxy: macroDxy,
    },
    timestamp: new Date().toISOString(),
  });
}
