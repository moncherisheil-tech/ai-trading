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
import { sql } from '@/lib/db/sql';

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
  const anthropicKey = hasEnv('ANTHROPIC_API_KEY') || hasEnv('CLAUDE_API_KEY');
  const pineconeKey = hasEnv('PINECONE_API_KEY');
  const pineconeIndex = hasEnv('PINECONE_INDEX_NAME');

  let gemini: 'ok' | 'fail' | 'skip' = geminiKey ? 'ok' : 'skip';
  let groq: 'ok' | 'fail' | 'skip' = groqKey ? 'ok' : 'skip';
  let anthropic: 'ok' | 'fail' | 'skip' = anthropicKey ? 'ok' : 'skip';
  let pinecone: 'ok' | 'fail' | 'skip' = pineconeKey && pineconeIndex ? 'ok' : 'skip';
  let postgres: 'ok' | 'fail' = 'fail';
  let dbHealth: { status: 'online' | 'offline'; error: string | null } = { status: 'offline', error: null };
  let vectorStorageHealth: { status: 'online' | 'offline' | 'skip'; error: string | null } = {
    status: pinecone === 'skip' ? 'skip' : 'offline',
    error: null,
  };

  try {
    await getAppSettings();
    await listOpenVirtualTrades();
    postgres = 'ok';
    dbHealth = { status: 'online', error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postgres = 'fail';
    dbHealth = { status: 'offline', error: message };
  }

  if (pinecone === 'ok') {
    try {
      const connection = await verifyPineconeConnectionStrict();
      if (!connection.ok) {
        pinecone = 'fail';
        vectorStorageHealth = { status: 'offline', error: connection.error || 'Pinecone connection failed.' };
      } else {
        vectorStorageHealth = { status: 'online', error: null };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pinecone = 'fail';
      vectorStorageHealth = { status: 'offline', error: message };
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

  let latestBoardMeetingAt: string | null = null;
  try {
    const { rows } = await sql`SELECT timestamp::text FROM board_meeting_logs ORDER BY timestamp DESC LIMIT 1`;
    const row = rows?.[0] as { timestamp?: string } | undefined;
    latestBoardMeetingAt = row?.timestamp ?? null;
  } catch {
    latestBoardMeetingAt = null;
  }

  const nowMs = Date.now();
  const lastPredictionMs = latestConsensus.prediction_date ? new Date(latestConsensus.prediction_date).getTime() : 0;
  const lastBoardMeetingMs = latestBoardMeetingAt ? new Date(latestBoardMeetingAt).getTime() : 0;
  const isRecentActivity = (tsMs: number): boolean => Number.isFinite(tsMs) && tsMs > 0 && nowMs - tsMs <= 24 * 60 * 60 * 1000;
  const predictionRecent = isRecentActivity(lastPredictionMs);
  const boardRecent = isRecentActivity(lastBoardMeetingMs);

  const buildAgentStatus = (
    name: string,
    ready: boolean,
    lastActiveAt: string | null,
    reason: string
  ): { name: string; status: 'ok' | 'fail'; reason: string; lastActiveAt: string | null } => ({
    name,
    status: ready ? 'ok' : 'fail',
    reason,
    lastActiveAt,
  });

  const latestActivityIso = latestConsensus.prediction_date ?? null;
  const agentStatuses = [
    buildAgentStatus(
      'Market Scanner',
      (geminiKey || groqKey) && predictionRecent,
      latestActivityIso,
      (geminiKey || groqKey)
        ? predictionRecent
          ? 'LLM key present and recent prediction activity detected.'
          : 'LLM key present but no recent prediction activity.'
        : 'Missing GEMINI_API_KEY/GROQ_API_KEY.'
    ),
    buildAgentStatus(
      'Risk Analyzer',
      postgres === 'ok' && predictionRecent,
      latestActivityIso,
      postgres === 'ok'
        ? predictionRecent
          ? 'Database connected with recent prediction activity.'
          : 'Database connected but no recent prediction activity.'
        : 'Database connection check failed.'
    ),
    buildAgentStatus(
      'Technical Analyst',
      geminiKey && predictionRecent,
      latestActivityIso,
      geminiKey
        ? predictionRecent
          ? 'GEMINI_API_KEY present with recent prediction activity.'
          : 'GEMINI_API_KEY present but no recent prediction activity.'
        : 'Missing GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      'Fundamental Expert',
      anthropicKey && predictionRecent,
      latestActivityIso,
      anthropicKey
        ? predictionRecent
          ? 'ANTHROPIC_API_KEY present with recent prediction activity.'
          : 'ANTHROPIC_API_KEY present but no recent prediction activity.'
        : 'Missing ANTHROPIC_API_KEY/CLAUDE_API_KEY.'
    ),
    buildAgentStatus(
      'Execution Strategist',
      postgres === 'ok' && predictionRecent,
      latestActivityIso,
      postgres === 'ok'
        ? predictionRecent
          ? 'Database connected with recent prediction activity.'
          : 'Database connected but no recent prediction activity.'
        : 'Database connection check failed.'
    ),
    buildAgentStatus(
      'Sentiment Evaluator',
      anthropicKey && predictionRecent,
      latestActivityIso,
      anthropicKey
        ? predictionRecent
          ? 'ANTHROPIC_API_KEY present with recent prediction activity.'
          : 'ANTHROPIC_API_KEY present but no recent prediction activity.'
        : 'Missing ANTHROPIC_API_KEY/CLAUDE_API_KEY.'
    ),
    buildAgentStatus(
      'System Overseer',
      (geminiKey || groqKey || anthropicKey) && (boardRecent || predictionRecent),
      latestBoardMeetingAt ?? latestActivityIso,
      geminiKey || groqKey || anthropicKey
        ? boardRecent || predictionRecent
          ? 'Model key present with recent overseer/prediction activity.'
          : 'Model key present but no recent overseer activity.'
        : 'Missing model API keys.'
    ),
  ];

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
      anthropic,
      pinecone,
      postgres,
    },
    healthChecks: {
      db: dbHealth,
      vectorStorage: vectorStorageHealth,
    },
    agents: agentStatuses,
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
