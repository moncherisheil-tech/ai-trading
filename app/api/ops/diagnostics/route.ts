/**
 * GET /api/ops/diagnostics — The Engine Room: Infrastructure + Singularity Intelligence feed.
 *
 * Returns:
 *   - connections: live Gemini / Groq / Anthropic / Pinecone / Postgres / Redis ping status
 *   - agents: all 7 MoE experts + Overseer (8 rows total)
 *   - systemIntegrity: latest consensus record
 *   - deepMemorySync: last Pinecone upsert
 *   - macroHealth: DXY feed
 *   - neuroPlasticity: live SystemNeuroPlasticity (id=1) — 7 expert weights + CEO + robot params
 *   - episodicMemory: 10 most recent EpisodicMemory lessons written by the RL engine
 *   - timestamp
 *
 * Requires admin session when SESSION_SECRET is set.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { getDbAsync } from '@/lib/db';
import { getLastPineconeUpsertAt } from '@/lib/db/ops-metadata';
import { getAppSettings } from '@/lib/db/app-settings';
import { listOpenVirtualTrades } from '@/lib/db/virtual-portfolio';
import { fetchMacroContext } from '@/lib/api-utils';
import { sql } from '@/lib/db/sql';
import { getPrisma } from '@/lib/prisma';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return typeof v === 'string' && v.trim().length > 0;
}

async function pingRedis(): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const url = process.env.REDIS_URL;
  if (!url) return { ok: false, latencyMs: 0, error: 'REDIS_URL not set' };
  try {
    const IORedis = (await import('ioredis')).default;
    const client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      connectTimeout: 5_000,
      lazyConnect: true,
      tls: url.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    });
    const start = Date.now();
    await client.connect();
    const pong = await client.ping();
    const latencyMs = Date.now() - start;
    await client.quit().catch(() => client.disconnect());
    return { ok: pong === 'PONG', latencyMs, error: null };
  } catch (err) {
    return { ok: false, latencyMs: 0, error: err instanceof Error ? err.message : String(err) };
  }
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

  const geminiKey  = hasEnv('GEMINI_API_KEY');
  const groqKey    = hasEnv('GROQ_API_KEY');
  const anthropicKey = hasEnv('ANTHROPIC_API_KEY') || hasEnv('CLAUDE_API_KEY');
  const pineconeKey  = hasEnv('PINECONE_API_KEY');
  const pineconeIndex = hasEnv('PINECONE_INDEX_NAME');

  let gemini:   'ok' | 'fail' | 'skip' = geminiKey ? 'ok' : 'skip';
  let groq:     'ok' | 'fail' | 'skip' = groqKey ? 'ok' : 'skip';
  let anthropic:'ok' | 'fail' | 'skip' = anthropicKey ? 'ok' : 'skip';
  let pinecone: 'ok' | 'fail' | 'skip' = pineconeKey && pineconeIndex ? 'ok' : 'skip';
  let postgres: 'ok' | 'fail' = 'fail';
  let dbHealth: { status: 'online' | 'offline'; error: string | null } = { status: 'offline', error: null };
  let vectorStorageHealth: { status: 'online' | 'offline' | 'skip'; error: string | null } = {
    status: pinecone === 'skip' ? 'skip' : 'offline',
    error: null,
  };

  // ── Postgres ping ──────────────────────────────────────────────────────────────────────────────
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

  // ── Redis ping ─────────────────────────────────────────────────────────────────────────────────
  const redisPing = await pingRedis();
  const redisStatus: 'ok' | 'fail' | 'skip' = !process.env.REDIS_URL
    ? 'skip'
    : redisPing.ok
      ? 'ok'
      : 'fail';

  // ── Pinecone ping ──────────────────────────────────────────────────────────────────────────────
  if (pinecone === 'ok') {
    try {
      const { verifyPineconeConnectionStrict } = await import('@/lib/vector-db');
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

  // ── Latest consensus ───────────────────────────────────────────────────────────────────────────
  let latestConsensus: { saved: boolean; prediction_date: string | null; symbol?: string } = {
    saved: false,
    prediction_date: null,
  };
  try {
    const records = await getDbAsync();
    const withConsensus = records.filter((r) => r.master_insight_he != null && r.final_confidence != null);
    const latest = withConsensus.sort(
      (a, b) => new Date(b.prediction_date).getTime() - new Date(a.prediction_date).getTime()
    )[0];
    if (latest) {
      latestConsensus = { saved: true, prediction_date: latest.prediction_date, symbol: latest.symbol };
    }
  } catch {
    latestConsensus = { saved: false, prediction_date: null };
  }

  // ── Board meeting logs ─────────────────────────────────────────────────────────────────────────
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
  const isRecentActivity = (tsMs: number): boolean =>
    Number.isFinite(tsMs) && tsMs > 0 && nowMs - tsMs <= 24 * 60 * 60 * 1000;
  const predictionRecent = isRecentActivity(lastPredictionMs);
  const boardRecent = isRecentActivity(lastBoardMeetingMs);

  const buildAgentStatus = (
    name: string,
    ready: boolean,
    lastActiveAt: string | null,
    reason: string
  ) => ({ name, status: (ready ? 'ok' : 'fail') as 'ok' | 'fail', reason, lastActiveAt });

  const latestActivityIso = latestConsensus.prediction_date ?? null;

  // All 7 MoE experts + Overseer (CEO)
  const agentStatuses = [
    buildAgentStatus(
      'Technician (Expert 1)',
      (geminiKey || groqKey) && predictionRecent,
      latestActivityIso,
      (geminiKey || groqKey)
        ? predictionRecent ? 'LLM key present and recent prediction activity detected.' : 'LLM key present but no recent prediction activity.'
        : 'Missing GEMINI_API_KEY/GROQ_API_KEY.'
    ),
    buildAgentStatus(
      'Risk Manager (Expert 2)',
      postgres === 'ok' && predictionRecent,
      latestActivityIso,
      postgres === 'ok'
        ? predictionRecent ? 'Database connected with recent prediction activity.' : 'Database connected but no recent prediction activity.'
        : 'Database connection check failed.'
    ),
    buildAgentStatus(
      'Market Psychologist (Expert 3)',
      geminiKey && predictionRecent,
      latestActivityIso,
      geminiKey
        ? predictionRecent ? 'GEMINI_API_KEY present with recent prediction activity.' : 'GEMINI_API_KEY present but no recent prediction activity.'
        : 'Missing GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      'Macro & Order Book (Expert 4)',
      (groqKey || geminiKey) && predictionRecent,
      latestActivityIso,
      (groqKey || geminiKey)
        ? predictionRecent ? 'Model key present with recent prediction activity.' : 'Model key present but no recent prediction activity.'
        : 'Missing GROQ_API_KEY/GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      'On-Chain Sleuth (Expert 5)',
      geminiKey && predictionRecent,
      latestActivityIso,
      geminiKey
        ? predictionRecent ? 'GEMINI_API_KEY present with recent prediction activity.' : 'GEMINI_API_KEY present but no recent prediction activity.'
        : 'Missing GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      'Deep Memory (Expert 6)',
      geminiKey && (pinecone === 'ok' || pinecone === 'skip') && predictionRecent,
      latestActivityIso,
      geminiKey
        ? predictionRecent ? 'GEMINI_API_KEY + vector store present with recent activity.' : 'Keys present but no recent prediction activity.'
        : 'Missing GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      'Contrarian Devil\'s Advocate (Expert 7)',
      geminiKey && predictionRecent,
      latestActivityIso,
      geminiKey
        ? predictionRecent ? 'GEMINI_API_KEY present — adversarial expert contributing to final_confidence.' : 'GEMINI_API_KEY present but no recent prediction activity.'
        : 'Missing GEMINI_API_KEY — Expert 7 (Contrarian) unavailable.'
    ),
    buildAgentStatus(
      'CEO Overseer (Judge)',
      (geminiKey || groqKey || anthropicKey) && (boardRecent || predictionRecent),
      latestBoardMeetingAt ?? latestActivityIso,
      geminiKey || groqKey || anthropicKey
        ? boardRecent || predictionRecent ? 'Model key present with recent overseer/prediction activity.' : 'Model key present but no recent overseer activity.'
        : 'Missing model API keys.'
    ),
  ];

  // ── Pinecone last upsert ───────────────────────────────────────────────────────────────────────
  let lastPineconeUpsert: string | null = null;
  try {
    lastPineconeUpsert = await getLastPineconeUpsertAt();
  } catch { /* non-fatal */ }

  // ── DXY macro health ──────────────────────────────────────────────────────────────────────────
  // Hard 5-second cap: external APIs (CoinGecko, Yahoo) can return 429 with Retry-After: 60s.
  // fetchWithBackoff with maxRetries=3 would wait up to 2×60s = 120s → 504. We race against a
  // 5-second sentinel so the diagnostics response is always delivered promptly, regardless of
  // third-party rate limits. The macro snapshot is purely informational on this page.
  const MACRO_LOAD_TIMEOUT_MS = 5_000;
  let macroDxy: {
    status: 'ok' | 'fail';
    value: number | null;
    source: string | null;
    note: string;
    updatedAt: string | null;
  } = { status: 'fail', value: null, source: null, note: 'DXY diagnostics unavailable.', updatedAt: null };
  try {
    const macro = await Promise.race([
      fetchMacroContext(MACRO_LOAD_TIMEOUT_MS),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), MACRO_LOAD_TIMEOUT_MS)),
    ]);
    if (macro) {
      macroDxy = {
        status: macro.dxyStatus ?? (typeof macro.dxyValue === 'number' ? 'ok' : 'fail'),
        value: typeof macro.dxyValue === 'number' ? macro.dxyValue : null,
        source: macro.dxySource ?? null,
        note: macro.dxyNote,
        updatedAt: macro.updatedAt ?? null,
      };
    }
  } catch { /* keep fail defaults */ }

  // ── SystemNeuroPlasticity (id=1) ──────────────────────────────────────────────────────────────
  type NeuroPlasticityPayload = {
    techWeight: number;
    riskWeight: number;
    psychWeight: number;
    macroWeight: number;
    onchainWeight: number;
    deepMemoryWeight: number;
    contrarianWeight: number;
    ceoConfidenceThreshold: number;
    ceoRiskTolerance: number;
    robotSlBufferPct: number;
    robotTpAggressiveness: number;
    updatedAt: string | null;
  } | null;

  let neuroPlasticity: NeuroPlasticityPayload = null;
  try {
    const prisma = getPrisma();
    if (prisma) {
      const row = await prisma.systemNeuroPlasticity.findUnique({ where: { id: 1 } });
      if (row) {
        neuroPlasticity = {
          techWeight: row.techWeight,
          riskWeight: row.riskWeight,
          psychWeight: row.psychWeight,
          macroWeight: row.macroWeight,
          onchainWeight: row.onchainWeight,
          deepMemoryWeight: row.deepMemoryWeight,
          contrarianWeight: row.contrarianWeight,
          ceoConfidenceThreshold: row.ceoConfidenceThreshold,
          ceoRiskTolerance: row.ceoRiskTolerance,
          robotSlBufferPct: row.robotSlBufferPct,
          robotTpAggressiveness: row.robotTpAggressiveness,
          updatedAt: row.updatedAt?.toISOString() ?? null,
        };
      }
    }
  } catch { /* non-fatal; UI handles null */ }

  // ── EpisodicMemory feed (10 most recent lessons) ──────────────────────────────────────────────
  type EpisodicLesson = {
    id: string;
    symbol: string;
    marketRegime: string;
    abstractLesson: string;
    createdAt: string;
  };
  let episodicMemory: EpisodicLesson[] = [];
  try {
    const prisma = getPrisma();
    if (prisma) {
      const rows = await prisma.episodicMemory.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, symbol: true, marketRegime: true, abstractLesson: true, createdAt: true },
      });
      episodicMemory = rows.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        marketRegime: r.marketRegime,
        abstractLesson: r.abstractLesson,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({
    connections: { gemini, groq, anthropic, pinecone, postgres, redis: redisStatus },
    redisPing: {
      latencyMs: redisPing.latencyMs,
      error: redisPing.error,
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
    macroHealth: { dxy: macroDxy },
    neuroPlasticity,
    episodicMemory,
    timestamp: new Date().toISOString(),
  });
}
