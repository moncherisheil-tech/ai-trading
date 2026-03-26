import { getGeminiApiKey } from '@/lib/env';
import { withGeminiRateLimitRetry } from '@/lib/gemini-model';

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
const PINECONE_QUERY_TIMEOUT_MS = 12_000;
type PineconeRecordMetadata = Record<string, unknown>;

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
export const GEMINI_EMBEDDING_MODEL_ID = 'embedding-001';

/** Default vector size when Pinecone env dim unset (Matryoshka / reduced dim for gemini-embedding-001). */
export const GEMINI_EMBEDDING_DIMENSION = 768;
const EMBEDDING_FAILFAST_TIMEOUT_MS = 8_000;

function getEmbeddingModelCandidates(): string[] {
  const env = process.env.GEMINI_EMBEDDING_MODEL_ID?.trim();
  const stable = 'embedding-001';
  if (env) return [env, stable].filter((m, i, arr) => arr.indexOf(m) === i);
  return [stable];
}

function getExpectedEmbeddingDim(): number {
  const raw = process.env.PINECONE_EMBEDDING_DIM;
  if (typeof raw === 'undefined' || raw.trim() === '') return GEMINI_EMBEDDING_DIMENSION;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return GEMINI_EMBEDDING_DIMENSION;
  return Math.max(1, Math.min(4096, parsed));
}

/**
 * v1 REST :embedContent for `embedding-001`.
 */
async function embedTextWithGeminiRest(text: string, apiKey: string): Promise<number[]> {
  const dim = getExpectedEmbeddingDim();
  const candidates = getEmbeddingModelCandidates();
  let lastBody = '';
  for (const modelId of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1/models/${modelId}:embedContent?key=${encodeURIComponent(apiKey)}`;
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
      `Embedding dimension mismatch (${values.length} !== ${expectedDim}). Set PINECONE_EMBEDDING_DIM to match the model output or your Pinecone index.`
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
  const devLog = process.env.NODE_ENV !== 'production';
  if (devLog) {
    console.log(
      '[vector-db] storePostMortem invoked',
      { hasKey: !!apiKey, hasIndex: !!indexName, textLen: whyWinLose?.length ?? 0 }
    );
  }
  if (!apiKey || !indexName || !whyWinLose?.trim()) {
    if (devLog) {
      if (!apiKey) console.log('[vector-db] Skipping storePostMortem: missing PINECONE_API_KEY.');
      if (!indexName) console.log('[vector-db] Skipping storePostMortem: missing PINECONE_INDEX_NAME.');
      if (!whyWinLose?.trim()) {
        console.log('[vector-db] Skipping storePostMortem: whyWinLose text is empty or whitespace.');
      }
    }
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
    await index.namespace(POST_MORTEMS_NAMESPACE).upsert({
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
    });
    await setLastUpsertNow();
    if (devLog) {
      console.log('[vector-db] Upserted post-mortem to Pinecone.', {
        index: indexName,
        namespace: POST_MORTEMS_NAMESPACE,
        dimension: values.length,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isDimError = /dimension/i.test(message);
    console.error('[vector-db] Pinecone upsert failed.', {
      index: indexName,
      namespace: POST_MORTEMS_NAMESPACE,
      dimension: getExpectedEmbeddingDim(),
      error: message,
      hint: isDimError
        ? 'Pinecone index must be 768 dims for embedding-001 unless PINECONE_EMBEDDING_DIM overrides.'
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
        return index.namespace(POST_MORTEMS_NAMESPACE).query({
          vector: queryVector,
          topK: Math.min(topK, 10),
          includeMetadata: true,
        });
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

    console.error('[vector-db] Pinecone query failed.', {
      index: indexName,
      namespace: POST_MORTEMS_NAMESPACE,
      dimension: getExpectedEmbeddingDim(),
      error: message,
      hint: isDimError
        ? 'Pinecone index must be 768 dims for embedding-001 unless PINECONE_EMBEDDING_DIM overrides.'
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
    await index.namespace(BOARD_MEETINGS_NAMESPACE).upsert({
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
    });
    await setLastUpsertNow();
    if (process.env.NODE_ENV !== 'production') {
      console.log('[vector-db] Upserted board meeting memory to Pinecone.', {
        index: indexName,
        namespace: BOARD_MEETINGS_NAMESPACE,
        symbol: input.symbol,
      });
    }
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
    await index.namespace(DIAGNOSTICS_NAMESPACE).upsert({
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
    });
    const query = await index.namespace(DIAGNOSTICS_NAMESPACE).query({
      vector,
      topK: 5,
      includeMetadata: true,
    });
    const verifiedByQuery = (query.matches ?? []).some((m) => {
      const metadata = m.metadata as Record<string, unknown> | undefined;
      return String(metadata?.probe_id ?? '') === probeId;
    });
    await setLastUpsertNow();
    return {
      ok: true,
      probeId,
      verifiedByQuery,
      index: resolvedIndexName,
      ...(verifiedByQuery ? {} : { error: 'Probe upsert succeeded but verification query did not return probe_id.' }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      probeId: null,
      verifiedByQuery: false,
      index: indexName,
      error: message,
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
    const result = await index.namespace('academy').query({
      vector,
      topK: Math.min(Math.max(topK, 1), 10),
      includeMetadata: true,
    });
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
