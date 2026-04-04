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
 *
 * INDESTRUCTIBLE HEARTBEAT CONTRACT:
 *   This route NEVER returns HTTP 5xx. Every failure mode — whether the German
 *   servers at 178.104.75.47 / 88.99.208.99 are unreachable, a Prisma query
 *   hangs, or the handler itself throws — is caught and reported as an OFFLINE
 *   status inside the JSON payload with HTTP 200. The client only ever sees 200.
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

// ─── Hard timeout wrapper ──────────────────────────────────────────────────────
// Races any promise against a deadline. The rejected timeout error is caught by
// Promise.allSettled so it never propagates to the outer handler.
const DB_PROBE_TIMEOUT_MS    = 3_000;   // Postgres / Prisma queries
const REDIS_PROBE_TIMEOUT_MS = 3_000;   // Redis connect + PING round-trip

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`[ops/diagnostics] ${label} timed out after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

// ─── All-OFFLINE fallback payload ─────────────────────────────────────────────
// Returned (with HTTP 200) when the handler itself crashes so the client always
// receives a well-typed payload instead of an opaque 500.
function buildOfflinePayload(reason: string) {
  const OFFLINE_HB = { alive: false, lastBeatAt: null, staleSinceMs: null };
  return {
    connections: { gemini: 'skip', groq: 'skip', anthropic: 'skip', pinecone: 'skip', postgres: 'fail', redis: 'fail' } as const,
    redisPing:   { latencyMs: 0, error: reason },
    workerHeartbeat: OFFLINE_HB,
    healthChecks: {
      db:            { status: 'offline' as const, error: reason },
      vectorStorage: { status: 'offline' as const, error: reason },
    },
    agents:          [],
    systemIntegrity: { latestConsensusSaved: false, latestConsensusPredictionDate: null, latestConsensusSymbol: null },
    deepMemorySync:  { lastPineconeUpsertAt: null, pineconeIndex: null, pineconeConfigured: false },
    macroHealth:     { dxy: { status: 'fail' as const, value: null, source: null, note: reason, updatedAt: null } },
    neuroPlasticity: null,
    episodicMemory:  [],
    timestamp:       new Date().toISOString(),
    _degraded:       true,
    _degradedReason: reason,
  };
}

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
  const defaultHb: { alive: boolean; lastBeatAt: string | null; staleSinceMs: number | null } = { alive: false, lastBeatAt: null, staleSinceMs: null };
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
  try {
    return await getImpl();
  } catch (fatal) {
    // GOLDEN RULE: this route NEVER returns 5xx.
    // Any unhandled exception — including a crashed Prisma client, an import
    // failure, or a type error in result processing — is caught here and
    // reported as HTTP 200 with all connections marked OFFLINE. The frontend
    // heartbeat polling will receive valid JSON on every poll, always.
    const msg = fatal instanceof Error ? fatal.message : String(fatal);
    const stack = fatal instanceof Error ? fatal.stack : '';
    console.error(
      '[ops/diagnostics] ⚠️  Fatal handler error — returning degraded 200 payload:',
      msg,
      stack
    );
    return NextResponse.json(buildOfflinePayload(`handler_error: ${msg}`), { status: 200 });
  }
}

async function getImpl(): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Guard: if DATABASE_URL is absent, getPrisma() returns null and any
  // property access on the prisma Proxy throws synchronously. Return the
  // offline payload immediately rather than letting the throw propagate
  // through the Promise.allSettled array construction.
  const { getPrisma } = await import('@/lib/prisma');
  if (!getPrisma()) {
    return NextResponse.json(
      buildOfflinePayload('DATABASE_URL not configured — Prisma client unavailable'),
      { status: 200 }
    );
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

  // ── Fire ALL I/O in parallel ──────────────────────────────────────────────────────────────────
  // Previously each operation awaited sequentially (postgres → redis → pinecone → DB queries →
  // macro → neuroPlasticity → episodicMemory). With cross-border latency to 178.104.75.47 and
  // 88.99.208.99 each round-trip adds 100–300 ms; 8 sequential calls = 800 ms–2.4 s minimum.
  // Promise.allSettled fires them all at once and processes results after all settle.
  const MACRO_LOAD_TIMEOUT_MS = 5_000;

  const [
    postgresRes,
    redisPingRes,
    pineconeRes,
    consensusRes,
    boardRes,
    macroRes,
    neuroRes,
    episodicRes,
  ] = await Promise.allSettled([
    // 1. Postgres liveness ping — hard 3 s cap prevents cross-border hang (178.104.75.47)
    withTimeout(
      prisma.$queryRaw`SELECT 1`,
      DB_PROBE_TIMEOUT_MS,
      'postgres SELECT 1'
    ),
    // 2. Redis ping + worker heartbeat — hard 3 s cap (88.99.208.99); IORedis has its
    //    own connectTimeout but we enforce an outer deadline for the full round-trip.
    withTimeout(pingRedis(), REDIS_PROBE_TIMEOUT_MS, 'redis ping'),
    // 3. Pinecone connection verification (skipped when not configured)
    pinecone === 'ok'
      ? import('@/lib/vector-db').then((m) => m.verifyPineconeConnectionStrict())
      : Promise.resolve(null),
    // 4. Latest consensus record
    withTimeout(getDbAsync(), DB_PROBE_TIMEOUT_MS, 'getDbAsync (consensus)'),
    // 5. Board meeting logs — last entry timestamp
    withTimeout(
      prisma.$queryRaw<{ timestamp: string }[]>`
        SELECT timestamp::text AS timestamp FROM board_meeting_logs ORDER BY timestamp DESC LIMIT 1
      `,
      DB_PROBE_TIMEOUT_MS,
      'board_meeting_logs query'
    ),
    // 6. DXY macro — hard 5 s cap; inner race preserved for macro service itself
    Promise.race([
      fetchMacroContext(MACRO_LOAD_TIMEOUT_MS),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), MACRO_LOAD_TIMEOUT_MS)),
    ]),
    // 7. NeuroPlasticity weights (id = 1) — hard 3 s cap
    withTimeout(
      prisma.systemNeuroPlasticity.findUnique({ where: { id: 1 } }),
      DB_PROBE_TIMEOUT_MS,
      'systemNeuroPlasticity.findUnique'
    ),
    // 8. Episodic memory — 10 most recent lessons — hard 3 s cap
    withTimeout(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma as any).episodicMemory.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, symbol: true, marketRegime: true, abstractLesson: true, createdAt: true },
      }),
      DB_PROBE_TIMEOUT_MS,
      'episodicMemory.findMany'
    ),
  ]);

  // ── Process results ───────────────────────────────────────────────────────────────────────────

  // Postgres
  if (postgresRes.status === 'fulfilled') {
    postgres = 'ok';
    dbHealth = { status: 'online', error: null };
  } else {
    const message = postgresRes.reason instanceof Error ? postgresRes.reason.message : String(postgresRes.reason);
    dbHealth = { status: 'offline', error: message };
  }

  // Redis
  const redisPing = redisPingRes.status === 'fulfilled'
    ? redisPingRes.value
    : { ok: false, latencyMs: 0, error: 'ping failed', workerHeartbeat: { alive: false, lastBeatAt: null, staleSinceMs: null } } as RedisPingResult;
  const redisStatus: 'ok' | 'fail' | 'skip' = redisPing.ok ? 'ok' : 'fail';
  const workerHeartbeat = redisPing.workerHeartbeat;

  // Pinecone
  if (pinecone === 'ok') {
    if (pineconeRes.status === 'fulfilled' && pineconeRes.value != null) {
      const conn = pineconeRes.value as { ok: boolean; error?: string };
      if (!conn.ok) {
        pinecone = 'fail';
        vectorStorageHealth = { status: 'offline', error: conn.error || 'Pinecone connection failed.' };
      } else {
        vectorStorageHealth = { status: 'online', error: null };
      }
    } else if (pineconeRes.status === 'rejected') {
      const message = pineconeRes.reason instanceof Error ? pineconeRes.reason.message : String(pineconeRes.reason);
      pinecone = 'fail';
      vectorStorageHealth = { status: 'offline', error: message };
    }
  }

  // Latest consensus
  let latestConsensus: { saved: boolean; prediction_date: string | null; symbol?: string } = {
    saved: false,
    prediction_date: null,
  };
  if (consensusRes.status === 'fulfilled') {
    const records = consensusRes.value as Array<{ master_insight_he?: unknown; final_confidence?: unknown; prediction_date: string; symbol: string }>;
    const withConsensus = records.filter((r) => r.master_insight_he != null && r.final_confidence != null);
    const latest = withConsensus.sort(
      (a, b) => new Date(b.prediction_date).getTime() - new Date(a.prediction_date).getTime()
    )[0];
    if (latest) {
      latestConsensus = { saved: true, prediction_date: latest.prediction_date, symbol: latest.symbol };
    }
  }

  // Board meeting logs
  let latestBoardMeetingAt: string | null = null;
  if (boardRes.status === 'fulfilled') {
    const rows = boardRes.value as Array<{ timestamp?: string }> | undefined;
    latestBoardMeetingAt = rows?.[0]?.timestamp ?? null;
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

  // ── DXY macro health (from parallel batch result) ─────────────────────────────────────────────
  let macroDxy: {
    status: 'ok' | 'fail';
    value: number | null;
    source: string | null;
    note: string;
    updatedAt: string | null;
  } = { status: 'fail', value: null, source: null, note: 'DXY diagnostics unavailable.', updatedAt: null };
  if (macroRes.status === 'fulfilled' && macroRes.value) {
    const macro = macroRes.value;
    macroDxy = {
      status: macro.dxyStatus ?? (typeof macro.dxyValue === 'number' ? 'ok' : 'fail'),
      value: typeof macro.dxyValue === 'number' ? macro.dxyValue : null,
      source: macro.dxySource ?? null,
      note: macro.dxyNote,
      updatedAt: macro.updatedAt ?? null,
    };
  }

  // ── Auto-seed NeuroPlasticity — fire-and-forget, never blocks the response ───────────────────
  // Runs only when Postgres is confirmed online. The background promise is intentionally detached:
  // we do not await it so the HTTP response is returned immediately to the client.
  if (postgres === 'ok') {
    void import('@/lib/learning/recursive-optimizer')
      .then(({ ensureNeuroPlasticityInitialized }) => ensureNeuroPlasticityInitialized())
      .catch((seedErr) => {
        const msg = seedErr instanceof Error ? seedErr.message : String(seedErr);
        console.warn('[ops/diagnostics] ensureNeuroPlasticityInitialized skipped (non-fatal):', msg);
      });
  }

  // ── SystemNeuroPlasticity (from parallel batch result) ────────────────────────────────────────
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
  if (neuroRes.status === 'fulfilled' && neuroRes.value) {
    const row = neuroRes.value;
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

  // ── EpisodicMemory feed (from parallel batch result) ──────────────────────────────────────────
  type EpisodicLesson = {
    id: string;
    symbol: string;
    marketRegime: string;
    abstractLesson: string;
    createdAt: string;
  };
  let episodicMemory: EpisodicLesson[] = [];
  if (episodicRes.status === 'fulfilled') {
    const rows = episodicRes.value as Array<{ id: string; symbol: string; marketRegime: string; abstractLesson: string; createdAt: Date }>;
    episodicMemory = rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      marketRegime: r.marketRegime,
      abstractLesson: r.abstractLesson,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));
  }

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
