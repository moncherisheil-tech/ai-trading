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
import { fetchMacroContext } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return typeof v === 'string' && v.trim().length > 0;
}

type RedisPingResult = {
  ok: boolean;
  latencyMs: number;
  error: string | null;
  workerHeartbeat: { alive: boolean; lastBeatAt: string | null; staleSinceMs: number | null };
};

async function pingRedis(): Promise<RedisPingResult> {
  const url = process.env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379';
  const defaultHb = { alive: false, lastBeatAt: null, staleSinceMs: null };
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
    // Single connection — PING + heartbeat GET in one round-trip batch.
    const [pong, hbValue] = await Promise.all([
      client.ping(),
      client.get('queue-worker:heartbeat'),
    ]);
    const latencyMs = Date.now() - start;
    await client.quit().catch(() => client.disconnect());

    let workerHeartbeat = defaultHb;
    if (hbValue) {
      const lastBeatMs = new Date(hbValue).getTime();
      workerHeartbeat = {
        alive: true,
        lastBeatAt: hbValue,
        staleSinceMs: Date.now() - lastBeatMs,
      };
    }
    return { ok: pong === 'PONG', latencyMs, error: null, workerHeartbeat };
  } catch (err) {
    return { ok: false, latencyMs: 0, error: err instanceof Error ? err.message : String(err), workerHeartbeat: defaultHb };
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

  // ── Postgres ping — live round-trip via Prisma ────────────────────────────────────────────────
  // Intentionally NOT using getAppSettings() / listOpenVirtualTrades() here — those helpers
  // swallow all DB errors internally and always return defaults, which would make this block
  // report "online" even when the database is completely unreachable.
  try {
    await prisma.$queryRaw`SELECT 1`;
    postgres = 'ok';
    dbHealth = { status: 'online', error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postgres = 'fail';
    dbHealth = { status: 'offline', error: message };
  }

  // ── Redis ping + worker heartbeat ─────────────────────────────────────────────────────────────
  // Single TCP connection handles both the PING and the heartbeat GET key read.
  const redisPing = await pingRedis();
  const redisStatus: 'ok' | 'fail' | 'skip' = redisPing.ok ? 'ok' : 'fail';
  const workerHeartbeat = redisPing.workerHeartbeat;

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
    const rows = await prisma.$queryRaw<{ timestamp: string }[]>`
      SELECT timestamp::text AS timestamp FROM board_meeting_logs ORDER BY timestamp DESC LIMIT 1
    `;
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
  const infra = postgres === 'ok';

  // ── Expert activation rules ────────────────────────────────────────────────
  // Experts are "Active" (ok) when:
  //   1. Their required API key(s) are present in the environment.
  //   2. Core infrastructure (Postgres) is reachable.
  // `predictionRecent` is surfaced in `reason` for observability but DOES NOT
  // gate the status — experts are ready to run even before the first cycle fires.
  const activityNote = (hasKey: boolean): string =>
    !hasKey
      ? ''
      : predictionRecent
        ? ' Recent prediction activity confirmed.'
        : ' No prediction activity in the last 24 h — will activate on next scan cycle.';

  const agentStatuses = [
    buildAgentStatus(
      'Technician (Expert 1)',
      (geminiKey || groqKey) && infra,
      latestActivityIso,
      (geminiKey || groqKey) && infra
        ? `LLM key present — technical analysis engine ready.${activityNote(true)}`
        : !infra ? 'Database offline — infrastructure required.' : 'Missing GEMINI_API_KEY or GROQ_API_KEY.'
    ),
    buildAgentStatus(
      'Risk Manager (Expert 2)',
      (geminiKey || groqKey) && infra,
      latestActivityIso,
      (geminiKey || groqKey) && infra
        ? `LLM key + database connected — risk engine ready.${activityNote(true)}`
        : !infra ? 'Database offline.' : 'Missing GEMINI_API_KEY or GROQ_API_KEY.'
    ),
    buildAgentStatus(
      'Market Psychologist (Expert 3)',
      geminiKey && infra,
      latestActivityIso,
      geminiKey && infra
        ? `GEMINI_API_KEY present — sentiment engine ready.${activityNote(true)}`
        : !infra ? 'Database offline.' : 'Missing GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      'Macro & Order Book (Expert 4)',
      (groqKey || geminiKey) && infra,
      latestActivityIso,
      (groqKey || geminiKey) && infra
        ? `Model key present — macro/order-book engine ready.${activityNote(true)}`
        : !infra ? 'Database offline.' : 'Missing GROQ_API_KEY or GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      'On-Chain Sleuth (Expert 5)',
      geminiKey && infra,
      latestActivityIso,
      geminiKey && infra
        ? `GEMINI_API_KEY present — on-chain analysis engine ready.${activityNote(true)}`
        : !infra ? 'Database offline.' : 'Missing GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      'Deep Memory (Expert 6)',
      geminiKey && infra,
      latestActivityIso,
      geminiKey && infra
        ? `GEMINI_API_KEY + ${pinecone === 'ok' ? 'Pinecone connected' : 'Pinecone optional'} — deep memory ready.${activityNote(true)}`
        : !infra ? 'Database offline.' : 'Missing GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      "Contrarian Devil's Advocate (Expert 7)",
      geminiKey && infra,
      latestActivityIso,
      geminiKey && infra
        ? `GEMINI_API_KEY present — adversarial expert ready.${activityNote(true)}`
        : !infra ? 'Database offline.' : 'Missing GEMINI_API_KEY.'
    ),
    buildAgentStatus(
      'CEO Overseer (Judge)',
      (geminiKey || groqKey || anthropicKey) && infra,
      latestBoardMeetingAt ?? latestActivityIso,
      (geminiKey || groqKey || anthropicKey) && infra
        ? `Model key present — overseer ready.${boardRecent || predictionRecent ? ' Recent board activity confirmed.' : ' Awaiting first board meeting.'}`
        : !infra ? 'Database offline.' : 'Missing model API keys (GEMINI / GROQ / ANTHROPIC).'
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

  // ── Auto-seed NeuroPlasticity + EpisodicMemory if never initialized ──────────────────────────
  // Safe to run on every diagnostics request — ensureNeuroPlasticityInitialized() is idempotent.
  // It only writes when the singleton (id=1) is absent or when the episodicMemory table is empty.
  // Failure here is non-fatal: the UI will show null/empty and the user can trigger init manually.
  if (postgres === 'ok') {
    try {
      const { ensureNeuroPlasticityInitialized } = await import('@/lib/learning/recursive-optimizer');
      await ensureNeuroPlasticityInitialized();
    } catch (seedErr) {
      const msg = seedErr instanceof Error ? seedErr.message : String(seedErr);
      console.warn('[ops/diagnostics] ensureNeuroPlasticityInitialized skipped (non-fatal):', msg);
    }
  }

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (prisma as any).episodicMemory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, symbol: true, marketRegime: true, abstractLesson: true, createdAt: true },
    })) as Array<{ id: string; symbol: string; marketRegime: string; abstractLesson: string; createdAt: Date }>;
    episodicMemory = rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      marketRegime: r.marketRegime,
      abstractLesson: r.abstractLesson,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch { /* non-fatal */ }

  return NextResponse.json({
    connections: { gemini, groq, anthropic, pinecone, postgres, redis: redisStatus },
    redisPing: {
      latencyMs: redisPing.latencyMs,
      error: redisPing.error,
    },
    workerHeartbeat,
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
