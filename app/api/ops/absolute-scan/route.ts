/**
 * GET /api/ops/absolute-scan
 *
 * Zero-trust infrastructure probe for bin/absolute-truth-scanner.ts.
 * Runs directly on the server — queries Postgres, Redis, Pinecone, Neuroplasticity, EpisodicMemory.
 *
 * Auth: Authorization: Bearer <SCAN_TOKEN env var OR hardcoded fallback>
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const FALLBACK_TOKEN = 'qmc-absolute-scan-2026-03-31';

function isAuthorized(request: Request): boolean {
  const token = process.env.SCAN_TOKEN?.trim() || FALLBACK_TOKEN;
  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim() === token;
  return false;
}

function sanitizeUrl(url: string): boolean {
  return /127\.0\.0\.1|localhost|::1/.test(url);
}

async function probePostgres() {
  const url = (process.env.DATABASE_URL ?? '').replace(/\r|'|"/g, '').trim();
  if (!url) return { ok: false, latencyMs: 0, rows: null, error: 'DATABASE_URL not set' };
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: sanitizeUrl(url) ? false : undefined,
    max: 1,
    connectionTimeoutMillis: 8_000,
  });
  const t0 = Date.now();
  try {
    const r = await pool.query('SELECT 1 AS probe');
    const latencyMs = Date.now() - t0;
    await pool.end().catch(() => {});
    return { ok: true, latencyMs, rows: r.rows, error: null };
  } catch (err) {
    await pool.end().catch(() => {});
    return { ok: false, latencyMs: Date.now() - t0, rows: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function probeRedis() {
  const url = (process.env.REDIS_URL ?? 'redis://127.0.0.1:6379').replace(/\r|'|"/g, '').trim();
  const IORedis = (await import('ioredis')).default;
  const client = new IORedis(url, {
    connectTimeout: 8_000,
    maxRetriesPerRequest: 0,
    lazyConnect: true,
    enableOfflineQueue: false,
    tls: url.startsWith('rediss://') ? {} : undefined,
  });
  const t0 = Date.now();
  try {
    await client.connect();
    const pong = await client.ping();
    const latencyMs = Date.now() - t0;
    const heartbeatVal = await client.get('queue-worker:heartbeat');
    const heartbeatTTL = await client.ttl('queue-worker:heartbeat');
    client.disconnect();
    return { ok: pong === 'PONG', pong, latencyMs, heartbeatVal, heartbeatTTL, error: null };
  } catch (err) {
    client.disconnect();
    return { ok: false, pong: null, latencyMs: Date.now() - t0, heartbeatVal: null, heartbeatTTL: -2, error: err instanceof Error ? err.message : String(err) };
  }
}

async function probePinecone() {
  const apiKey = (process.env.PINECONE_API_KEY ?? '').replace(/\r|'|"/g, '').trim();
  if (!apiKey) return { ok: false, dimension: null, totalVectors: null, error: 'PINECONE_API_KEY not set' };
  const HARDCODED = 'quantum-memory';
  let indexName = (process.env.PINECONE_INDEX_NAME ?? HARDCODED).replace(/\r|'|"/g, '').trim();
  if (/^\d+$/.test(indexName)) indexName = HARDCODED;
  const { Pinecone } = await import('@pinecone-database/pinecone');
  const pc = new Pinecone({ apiKey });
  const t0 = Date.now();
  try {
    const desc = await pc.describeIndex(indexName) as { dimension?: number; name?: string; status?: unknown };
    const stats = await pc.index(indexName).describeIndexStats();
    const latencyMs = Date.now() - t0;
    return {
      ok: true, latencyMs,
      dimension: desc.dimension ?? null,
      dimensionExact768: desc.dimension === 768,
      totalVectors: stats.totalRecordCount ?? 0,
      namespaces: Object.keys(stats.namespaces ?? {}),
      indexName,
      error: null,
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t0, dimension: null, dimensionExact768: false, totalVectors: null, namespaces: [], indexName, error: err instanceof Error ? err.message : String(err) };
  }
}

async function probeNeuroplasticity() {
  const url = (process.env.DATABASE_URL ?? '').replace(/\r|'|"/g, '').trim();
  if (!url) return { ok: false, exists: false, weights: null, allDefault: null, error: 'DATABASE_URL not set' };
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, ssl: sanitizeUrl(url) ? false : undefined, max: 1, connectionTimeoutMillis: 8_000 });
  try {
    const r = await pool.query<{
      id: number; techWeight: number; riskWeight: number; psychWeight: number;
      macroWeight: number; onchainWeight: number; deepMemoryWeight: number;
      contrarianWeight: number; ceoConfidenceThreshold: number; updatedAt: Date;
    }>(`SELECT id, "techWeight","riskWeight","psychWeight","macroWeight","onchainWeight","deepMemoryWeight","contrarianWeight","ceoConfidenceThreshold","updatedAt" FROM "SystemNeuroPlasticity" WHERE id=1 LIMIT 1`);
    await pool.end().catch(() => {});
    if (r.rows.length === 0) return { ok: true, exists: false, weights: null, allDefault: null, error: null };
    const row = r.rows[0];
    const weights = {
      techWeight: row.techWeight, riskWeight: row.riskWeight, psychWeight: row.psychWeight,
      macroWeight: row.macroWeight, onchainWeight: row.onchainWeight, deepMemoryWeight: row.deepMemoryWeight,
      contrarianWeight: row.contrarianWeight,
    };
    const allDefault = Object.values(weights).every(w => w === 1.0);
    return { ok: true, exists: true, weights, allDefault, ceoConfidenceThreshold: row.ceoConfidenceThreshold, updatedAt: row.updatedAt?.toISOString(), error: null };
  } catch (err) {
    await pool.end().catch(() => {});
    return { ok: false, exists: false, weights: null, allDefault: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function probeEpisodicMemory() {
  const url = (process.env.DATABASE_URL ?? '').replace(/\r|'|"/g, '').trim();
  if (!url) return { ok: false, totalCount: 0, last24hCount: 0, last3: [], error: 'DATABASE_URL not set' };
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, ssl: sanitizeUrl(url) ? false : undefined, max: 1, connectionTimeoutMillis: 8_000 });
  try {
    const total = await pool.query<{ n: string }>('SELECT COUNT(*) AS n FROM "EpisodicMemory"');
    const last24h = await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM "EpisodicMemory" WHERE "createdAt" > NOW() - INTERVAL '24 hours'`);
    const last3 = await pool.query<{ id: string; symbol: string; abstractLesson: string; createdAt: Date }>(
      `SELECT id, symbol, "abstractLesson", "createdAt" FROM "EpisodicMemory" ORDER BY "createdAt" DESC LIMIT 3`
    );
    await pool.end().catch(() => {});
    return {
      ok: true,
      totalCount: parseInt(total.rows[0]?.n ?? '0', 10),
      last24hCount: parseInt(last24h.rows[0]?.n ?? '0', 10),
      last3: last3.rows.map(r => ({ symbol: r.symbol, lesson: r.abstractLesson?.slice(0, 150), createdAt: r.createdAt?.toISOString() })),
      error: null,
    };
  } catch (err) {
    await pool.end().catch(() => {});
    return { ok: false, totalCount: 0, last24hCount: 0, last3: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized — provide Authorization: Bearer <SCAN_TOKEN>' }, { status: 401 });
  }

  const [postgres, redis, pinecone, neuro, memory] = await Promise.allSettled([
    probePostgres(),
    probeRedis(),
    probePinecone(),
    probeNeuroplasticity(),
    probeEpisodicMemory(),
  ]);

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    postgres: postgres.status === 'fulfilled' ? postgres.value : { ok: false, error: String(postgres.reason) },
    redis: redis.status === 'fulfilled' ? redis.value : { ok: false, error: String(redis.reason) },
    pinecone: pinecone.status === 'fulfilled' ? pinecone.value : { ok: false, error: String(pinecone.reason) },
    neuroplasticity: neuro.status === 'fulfilled' ? neuro.value : { ok: false, error: String(neuro.reason) },
    episodicMemory: memory.status === 'fulfilled' ? memory.value : { ok: false, error: String(memory.reason) },
  });
}
