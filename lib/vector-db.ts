import { getGeminiApiKey } from '@/lib/env';
import { withGeminiRateLimitRetry } from '@/lib/gemini-model';
import { sql } from '@/lib/db/sql';

/**
 * Vector DB (Pinecone) for Agent Deep Memory / RAG.
 * When Learning Center generates a Post-Mortem (why_win_lose), store it as an embedding.
 * Query for 3 most similar historical trades to inject into agents' context.
 * STRICT FALLBACK: If Pinecone fails or keys missing, bypass gracefully; consensus engine never crashes.
 */

const POST_MORTEMS_NAMESPACE = 'post-mortems';
const BOARD_MEETINGS_NAMESPACE = 'board-meetings';
const DIAGNOSTICS_NAMESPACE = 'diagnostics-probe';
const DEFAULT_TOP_K = 3;
/** Outer race for embed + Pinecone query; must exceed embedding budget + RPC + retries. */
const PINECONE_QUERY_TIMEOUT_MS = 40_000;
const PINECONE_EVENTUAL_CONSISTENCY_DELAY_MS = 10_000;
const PINECONE_TRANSIENT_RETRY_ATTEMPTS = 3;
const PINECONE_TRANSIENT_RETRY_BASE_MS = 800;
type PineconeRecordMetadata = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonRetryablePineconeMessage(message: string): boolean {
  const m = message.toLowerCase();
  if (/dimension mismatch|embedding dimension|vectors have a different dimension|pinecone index 1002|index 1002/i.test(m)) {
    return true;
  }
  if (/embedding vector is empty|cannot embed empty|invalid api key|missing pinecone|not found.*index/i.test(m)) {
    return true;
  }
  return false;
}

function isTransientPineconeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (isNonRetryablePineconeMessage(message)) return false;
  const m = message.toLowerCase();
  return /timeout|timed out|econnreset|etimedout|enotfound|socket|network|502|503|504|429|fetch failed|aborted|unavailable|eai_again|enetwork/i.test(
    m
  );
}

async function withPineconeTransientRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PINECONE_TRANSIENT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= PINECONE_TRANSIENT_RETRY_ATTEMPTS || !isTransientPineconeError(e)) {
        throw e;
      }
      const delay = PINECONE_TRANSIENT_RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(
        `[vector-db] ${label} transient failure (attempt ${attempt}/${PINECONE_TRANSIENT_RETRY_ATTEMPTS}), retry in ${delay}ms:`,
        e instanceof Error ? e.message : e
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

function getPineconeApiKey(): string | undefined {
  const key = process.env.PINECONE_API_KEY;
  if (!key || typeof key !== 'string' || key.trim() === '') return undefined;
  return key.trim();
}

function getPineconeIndexName(): string | undefined {
  const index = process.env.PINECONE_INDEX_NAME;
  if (!index || typeof index !== 'string' || index.trim() === '') return undefined;
  return index.trim();
}

async function getPineconeIndexOrThrow() {
  const apiKey = getPineconeApiKey();
  if (!apiKey) throw new Error('Missing PINECONE_API_KEY');
  const indexName = getPineconeIndexName();
  if (!indexName) throw new Error('Missing PINECONE_INDEX_NAME');
  const { Pinecone } = await import('@pinecone-database/pinecone');
  const pc = new Pinecone({ apiKey });
  return { index: pc.index(indexName), indexName };
}

async function setLastUpsertNow(): Promise<void> {
  try {
    const { setLastPineconeUpsertAt } = await import('@/lib/db/ops-metadata');
    await setLastPineconeUpsertAt(new Date().toISOString());
  } catch (err) {
    console.error('[vector-db] Failed to update last upsert timestamp:', err);
  }
}

/** Primary id for docs / env override. */
export const GEMINI_EMBEDDING_MODEL_ID = 'gemini-embedding-001';

/** Default vector size when Pinecone env dim unset (Matryoshka / reduced dim for gemini-embedding-001). */
export const GEMINI_EMBEDDING_DIMENSION = 768;
const EMBEDDING_FAILFAST_TIMEOUT_MS = 25_000;

function getEmbeddingModelCandidates(): string[] {
  const env = process.env.GEMINI_EMBEDDING_MODEL_ID?.trim();
  const stable = GEMINI_EMBEDDING_MODEL_ID;
  if (env) return [env, stable].map(normalizeEmbeddingModelId).filter((m, i, arr) => arr.indexOf(m) === i);
  return [stable];
}

function normalizeEmbeddingModelId(modelId: string): string {
  return modelId.replace(/^models\//, '').trim();
}

function getExpectedEmbeddingDim(): number {
  const raw = process.env.PINECONE_EMBEDDING_DIM;
  if (typeof raw === 'undefined' || raw.trim() === '') return GEMINI_EMBEDDING_DIMENSION;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return GEMINI_EMBEDDING_DIMENSION;
  return Math.max(1, Math.min(4096, parsed));
}

/**
 * v1beta REST :embedContent for `gemini-embedding-001`.
 */
async function embedTextWithGeminiRest(text: string, apiKey: string): Promise<number[]> {
  const dim = getExpectedEmbeddingDim();
  const candidates = getEmbeddingModelCandidates();
  let lastBody = '';
  for (const candidate of candidates) {
    const modelId = normalizeEmbeddingModelId(candidate);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:embedContent?key=${encodeURIComponent(apiKey)}`;
    const bodyWithDim = JSON.stringify({
      model: `models/${modelId}`,
      content: { parts: [{ text }] },
      outputDimensionality: dim,
    });
    const bodyPlain = JSON.stringify({
      model: `models/${modelId}`,
      content: { parts: [{ text }] },
    });
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyWithDim,
    });
    if (res.status === 400) {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyPlain,
      });
    }
    if (res.status === 429) {
      const err = new Error(`Gemini embedContent rate limited (429).`) as Error & { status: number };
      err.status = 429;
      throw err;
    }
    if (res.status === 404) {
      lastBody = await res.text().catch(() => '');
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini embedContent failed (${res.status}) model=${modelId}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as { embedding?: { values?: number[] } };
    const values = json.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`Gemini embedding response empty (model=${modelId}).`);
    }
    if (!values.every((v) => Number.isFinite(v))) {
      throw new Error('Gemini embedding contains non-finite values.');
    }
    return values;
  }
  throw new Error(
    `Gemini embedContent: no working embedding model in [${candidates.join(', ')}]. Last 404: ${lastBody.slice(0, 400)}`
  );
}

async function embedTextWithGemini(text: string): Promise<number[]> {
  const apiKey = getGeminiApiKey();
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Cannot embed empty text.');
  const values = await withGeminiRateLimitRetry(() => embedTextWithGeminiRest(trimmed, apiKey), {
    baseDelayMs: 10_000,
    maxAttempts: 6,
  });
  const expectedDim = getExpectedEmbeddingDim();
  if (values.length !== expectedDim) {
    throw new Error(
      `Embedding dimension mismatch: generated ${values.length} dimensions, but Pinecone index expects ${expectedDim}. Set PINECONE_EMBEDDING_DIM to match the model output or your Pinecone index configuration.`
    );
  }
  return values;
}

function withFailFastTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Embedding timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/** Lightweight health check for CEO readiness (no Pinecone write). */
export async function probeGeminiEmbedding(): Promise<{
  ok: boolean;
  dimension?: number;
  error?: string;
}> {
  try {
    const vec = await embedTextWithGemini('sovereign-readiness-probe');
    return { ok: true, dimension: vec.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export interface PostMortemMetadata {
  symbol: string;
  trade_id: number;
  created_at?: string;
  outcome?: string;
}

/**
 * Store a post-mortem (why_win_lose) in Pinecone. No-op if key/index missing.
 * On error, logs a clear console.error (no silent failure).
 */
export async function storePostMortem(
  whyWinLose: string,
  metadata: PostMortemMetadata
): Promise<void> {
  const apiKey = getPineconeApiKey();
  const indexName = getPineconeIndexName();
  if (!apiKey || !indexName || !whyWinLose?.trim()) {
    return;
  }
  try {
    const { index } = await getPineconeIndexOrThrow();
    const symKey = String(metadata.symbol || 'UNK')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    /** Stable id = UPSERT semantics: same paper-trade closure overwrites one vector. */
    const id = `pm-${symKey}-${metadata.trade_id}`;
    let values: number[];
    try {
      values = await embedTextWithGemini(whyWinLose);
    } catch (err) {
      console.error('[vector-db] Failed to generate embedding for post-mortem:', {
        error: err instanceof Error ? err.message : err,
      });
      return;
    }
    if (!Array.isArray(values) || values.length === 0) {
      console.error('[vector-db] Embedding dimension mismatch before upsert.', {
        expectedDimension: getExpectedEmbeddingDim(),
        actualLength: Array.isArray(values) ? values.length : null,
      });
      return;
    }
    await withPineconeTransientRetry('post-mortem.upsert', () =>
      index.namespace(POST_MORTEMS_NAMESPACE).upsert({
        records: [
          {
            id,
            values,
            metadata: {
              symbol: metadata.symbol,
              trade_id: metadata.trade_id,
              text: whyWinLose.slice(0, 1000),
              created_at: metadata.created_at ?? new Date().toISOString(),
              outcome: metadata.outcome ?? '',
            },
          },
        ],
      })
    );
    await setLastUpsertNow();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isDimError = /dimension/i.test(message);
    const expectedDim = getExpectedEmbeddingDim();
    const isIndexError = /1002|index/i.test(message);
    const fullErrorMsg = isDimError
      ? `Pinecone index 1002 ERROR: Dimension mismatch detected. Generated vectors have a different dimension than the index expects. Expected: ${expectedDim}. ${message}`
      : isIndexError
        ? `Pinecone index 1002 ERROR: ${message}. This typically indicates dimension mismatch (generated vs index expected: ${expectedDim}). Verify PINECONE_INDEX_NAME and PINECONE_EMBEDDING_DIM configuration.`
        : message;
    console.error('[vector-db] Pinecone upsert failed.', {
      index: indexName,
      namespace: POST_MORTEMS_NAMESPACE,
      expectedDimension: expectedDim,
      error: fullErrorMsg,
      errorCode: isIndexError ? 'INDEX_ERROR_1002' : isDimError ? 'DIMENSION_MISMATCH' : 'UNKNOWN',
      hint: isDimError
        ? `Pinecone index must accept ${expectedDim} dimensional vectors (gemini-embedding-001 default). Verify PINECONE_EMBEDDING_DIM env var matches your index configuration.`
        : isIndexError
          ? `Pinecone index 1002 error indicates dimension mismatch or misconfiguration. Check that the index supports ${expectedDim}-dimensional vectors.`
          : undefined,
    });
  }
}

export interface SimilarTradeHit {
  text: string;
  symbol: string;
  trade_id: number;
}

/**
 * Query Pinecone for the top-k most similar historical trades by symbol context.
 * Returns [] if key missing, index missing, empty index, or any error (no fatal throw).
 */
export async function querySimilarTrades(
  symbol: string,
  topK: number = DEFAULT_TOP_K
): Promise<SimilarTradeHit[]> {
  const apiKey = getPineconeApiKey();
  if (!apiKey) return [];
  const indexName = getPineconeIndexName();
  if (!indexName) {
    console.warn('[vector-db] PINECONE_INDEX_NAME is missing — skipping similar-trades query.');
    return [];
  }
  try {
    const { index } = await getPineconeIndexOrThrow();
    /** Pinecone client has no hard deadline; hung queries blocked the full MoE round. */
    const result = await Promise.race([
      (async () => {
        const queryVector = await withFailFastTimeout(
          embedTextWithGemini(`symbol ${symbol} trade post-mortem`),
          EMBEDDING_FAILFAST_TIMEOUT_MS
        );
        return withPineconeTransientRetry('similar-trades.query', () =>
          index.namespace(POST_MORTEMS_NAMESPACE).query({
            vector: queryVector,
            topK: Math.min(topK, 10),
            includeMetadata: true,
          })
        );
      })(),
      new Promise<never>((_, rej) =>
        setTimeout(
          () => rej(new Error(`Pinecone similar-trades query timeout (${PINECONE_QUERY_TIMEOUT_MS}ms)`)),
          PINECONE_QUERY_TIMEOUT_MS
        )
      ),
    ]);
    // Empty index or no matches returns []; do not throw.
    const matches = result?.matches ?? [];
    return matches
      .filter((m): m is typeof m & { metadata: PineconeRecordMetadata } => {
        const metadata = m.metadata as PineconeRecordMetadata | undefined;
        return typeof metadata?.text === 'string' && metadata.text.length > 0;
      })
      .slice(0, topK)
      .map((m) => ({
        text: String(m.metadata.text ?? ''),
        symbol: String(m.metadata.symbol ?? symbol),
        trade_id: Number(m.metadata.trade_id ?? 0),
      }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isDimError = /dimension/i.test(message);
    const expectedDim = getExpectedEmbeddingDim();
    const isIndexError = /1002|index/i.test(message);
    const fullErrorMsg = isDimError
      ? `Pinecone query failed: Dimension mismatch detected. Expected: ${expectedDim}. ${message}`
      : isIndexError
        ? `Pinecone index 1002 ERROR during query: ${message}. This typically indicates dimension mismatch (generated vs index expected: ${expectedDim}). Verify PINECONE_INDEX_NAME and PINECONE_EMBEDDING_DIM configuration.`
        : message;

    console.error('[vector-db] Pinecone query failed.', {
      index: indexName,
      namespace: POST_MORTEMS_NAMESPACE,
      expectedDimension: expectedDim,
      error: fullErrorMsg,
      errorCode: isIndexError ? 'INDEX_ERROR_1002' : isDimError ? 'DIMENSION_MISMATCH' : 'UNKNOWN',
      hint: isDimError
        ? `Pinecone index must accept ${expectedDim} dimensional vectors (gemini-embedding-001 default). Verify PINECONE_EMBEDDING_DIM env var matches your index configuration.`
        : isIndexError
          ? `Pinecone index 1002 error indicates dimension mismatch or misconfiguration. Check that the index supports ${expectedDim}-dimensional vectors.`
          : undefined,
    });
    return [];
  }
}

export interface BoardMeetingMemoryInput {
  triggerType: 'morning' | 'evening' | 'analysis';
  symbol: string;
  finalConsensus: string;
  expertSummaries: string[];
  source: 'board_worker' | 'analysis_core' | 'audit';
  occurredAt?: string;
}

export async function storeBoardMeetingMemory(input: BoardMeetingMemoryInput): Promise<void> {
  const apiKey = getPineconeApiKey();
  const indexName = getPineconeIndexName();
  if (!apiKey || !indexName) {
    console.warn('[vector-db] Skipping board meeting upsert: Pinecone is not fully configured.');
    return;
  }
  const mergedSummary = [
    `Board meeting (${input.triggerType}) for ${input.symbol}`,
    `Final consensus: ${input.finalConsensus}`,
    'Expert summaries:',
    ...input.expertSummaries.map((line, idx) => `${idx + 1}. ${line}`),
  ].join('\n');
  if (!mergedSummary.trim()) return;
  try {
    const { index } = await getPineconeIndexOrThrow();
    const id = `bm-${input.symbol}-${Date.now()}`;
    const values = await embedTextWithGemini(mergedSummary);
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error('Embedding vector is empty.');
    }
    await withPineconeTransientRetry('board-meeting.upsert', () =>
      index.namespace(BOARD_MEETINGS_NAMESPACE).upsert({
        records: [
          {
            id,
            values,
            metadata: {
              symbol: input.symbol,
              trigger_type: input.triggerType,
              source: input.source,
              final_consensus: input.finalConsensus.slice(0, 1000),
              text: mergedSummary.slice(0, 1000),
              occurred_at: input.occurredAt ?? new Date().toISOString(),
            },
          },
        ],
      })
    );
    await setLastUpsertNow();
  } catch (err) {
    console.error('[vector-db] Board meeting memory upsert failed:', err);
  }
}

export async function verifyPineconeConnectionStrict(): Promise<{ ok: boolean; index: string | null; error?: string }> {
  const indexName = getPineconeIndexName() ?? null;
  try {
    const { index, indexName: resolvedIndexName } = await getPineconeIndexOrThrow();
    await index.describeIndexStats();
    return { ok: true, index: resolvedIndexName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, index: indexName, error: message };
  }
}

export async function runPineconeUpsertProbe(symbol: string): Promise<{
  ok: boolean;
  probeId: string | null;
  verifiedByQuery: boolean;
  index: string | null;
  error?: string;
}> {
  const indexName = getPineconeIndexName() ?? null;
  try {
    const { index, indexName: resolvedIndexName } = await getPineconeIndexOrThrow();
    const probeId = `probe-${symbol}-${Date.now()}`;
    const text = `Integration probe for ${symbol} at ${new Date().toISOString()}`;
    const vector = await embedTextWithGemini(text);
    const upsertStartTime = Date.now();
    await withPineconeTransientRetry('probe.upsert', () =>
      index.namespace(DIAGNOSTICS_NAMESPACE).upsert({
        records: [
          {
            id: probeId,
            values: vector,
            metadata: {
              symbol,
              probe_id: probeId,
              text,
              created_at: new Date().toISOString(),
            },
          },
        ],
      })
    );

    await sleep(PINECONE_EVENTUAL_CONSISTENCY_DELAY_MS);

    const query = await withPineconeTransientRetry('probe.query', () =>
      index.namespace(DIAGNOSTICS_NAMESPACE).query({
        vector,
        topK: 5,
        includeMetadata: true,
      })
    );
    const verifiedByQuery = (query.matches ?? []).some((m) => {
      const metadata = m.metadata as Record<string, unknown> | undefined;
      return String(metadata?.probe_id ?? '') === probeId;
    });
    
    await setLastUpsertNow();
    
    if (verifiedByQuery) {
      try {
        const totalDuration = Date.now() - upsertStartTime;
        const settingValue = JSON.stringify({
          symbol,
          probeId,
          verifiedAt: new Date().toISOString(),
          duration_ms: totalDuration,
          consistency_delay_ms: PINECONE_EVENTUAL_CONSISTENCY_DELAY_MS,
        });
        await sql`
          INSERT INTO settings (key, value, "updatedAt")
          VALUES (
            'pinecone_probe_success',
            ${settingValue},
            NOW()
          )
          ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            "updatedAt" = NOW();
        `;
      } catch (settingErr) {
        console.warn('[vector-db] Failed to log probe success to settings table:', settingErr);
      }
    }
    
    return {
      ok: true,
      probeId,
      verifiedByQuery,
      index: resolvedIndexName,
      ...(verifiedByQuery ? {} : { error: 'Probe upsert succeeded but verification query did not return probe_id after 10-second eventual consistency delay.' }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const expectedDim = getExpectedEmbeddingDim();
    const isDimError = /dimension/i.test(message);
    const isIndexError = /1002|index/i.test(message);
    const enhancedError = isDimError || isIndexError
      ? `${message} [Expected dimension: ${expectedDim}]`
      : message;
    return {
      ok: false,
      probeId: null,
      verifiedByQuery: false,
      index: indexName,
      error: enhancedError,
    };
  }
}

export interface AcademyHit {
  id: string;
  score: number;
  text: string;
  reference: string | null;
}

/**
 * Query Academy RAG namespace for retrospective explanations.
 * Falls back to [] when Pinecone is unavailable or index is empty.
 */
export async function queryAcademyKnowledge(query: string, topK = 5): Promise<AcademyHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const apiKey = getPineconeApiKey();
  const indexName = getPineconeIndexName();
  if (!apiKey || !indexName) return [];
  try {
    const { index } = await getPineconeIndexOrThrow();
    const vector = await embedTextWithGemini(trimmed);
    const result = await withPineconeTransientRetry('academy.query', () =>
      index.namespace('academy').query({
        vector,
        topK: Math.min(Math.max(topK, 1), 10),
        includeMetadata: true,
      })
    );
    const matches = result?.matches ?? [];
    return matches
      .map((m) => {
        const metadata = (m.metadata || {}) as Record<string, unknown>;
        const text =
          typeof metadata.text === 'string'
            ? metadata.text
            : typeof metadata.content === 'string'
              ? metadata.content
              : '';
        if (!text) return null;
        return {
          id: String(m.id || ''),
          score: Number(m.score || 0),
          text,
          reference: typeof metadata.reference === 'string' ? metadata.reference : null,
        } satisfies AcademyHit;
      })
      .filter((x): x is AcademyHit => x != null);
  } catch (err) {
    console.error('[vector-db] Academy knowledge query failed:', err);
    return [];
  }
}
