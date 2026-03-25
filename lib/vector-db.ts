/**
 * Vector DB (Pinecone) for Agent Deep Memory / RAG.
 * When Learning Center generates a Post-Mortem (why_win_lose), store it as an embedding.
 * Query for 3 most similar historical trades to inject into agents' context.
 * STRICT FALLBACK: If Pinecone fails or keys missing, bypass gracefully; consensus engine never crashes.
 */

const POST_MORTEMS_NAMESPACE = 'post-mortems';
const BOARD_MEETINGS_NAMESPACE = 'board-meetings';
const DIAGNOSTICS_NAMESPACE = 'diagnostics-probe';
/** Must match your Pinecone index dimension (e.g. 1024 or 1536). Set PINECONE_EMBEDDING_DIM in .env if index uses 1024. */
const EMBEDDING_DIM = typeof process.env.PINECONE_EMBEDDING_DIM !== 'undefined' && Number.isFinite(Number(process.env.PINECONE_EMBEDDING_DIM))
  ? Math.max(1, Math.min(4096, Number(process.env.PINECONE_EMBEDDING_DIM)))
  : 1536;
const DEFAULT_TOP_K = 3;
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

/**
 * Placeholder embedding when no real embedding API (e.g. OpenAI, Gemini) is wired.
 * Produces deterministic pseudo-vectors so Pinecone ops don't fail; replace with real embed() for production.
 */
function mockEmbed(text: string): number[] {
  const arr: number[] = [];
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    arr.push(Math.sin((h + i) * 0.1) * 0.5 + 0.5);
  }
  return arr;
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
  console.log('🔍 [vector-db] storePostMortem invoked! apiKey present:', !!apiKey, '| index configured:', !!indexName, '| text length:', whyWinLose?.length || 0);
  if (!apiKey || !indexName || !whyWinLose?.trim()) {
    if (!apiKey) {
      console.log('[vector-db] Skipping storePostMortem: missing PINECONE_API_KEY.');
    }
    if (!indexName) {
      console.log('[vector-db] Skipping storePostMortem: missing PINECONE_INDEX_NAME.');
    }
    if (!whyWinLose?.trim()) {
      console.log('[vector-db] Skipping storePostMortem: whyWinLose text is empty or whitespace.');
    }
    return;
  }
  try {
    const { index } = await getPineconeIndexOrThrow();
    const id = `pm-${metadata.symbol}-${metadata.trade_id}-${Date.now()}`;
    let values: number[];
    try {
      values = mockEmbed(whyWinLose);
    } catch (err) {
      console.error('[vector-db] Failed to generate embedding for post-mortem:', {
        error: err instanceof Error ? err.message : err,
      });
      return;
    }
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIM) {
      console.error('[vector-db] Embedding dimension mismatch before upsert.', {
        expectedDimension: EMBEDDING_DIM,
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
    console.log('[vector-db] Upserted post-mortem to Pinecone.', {
      index: indexName,
      namespace: POST_MORTEMS_NAMESPACE,
      dimension: EMBEDDING_DIM,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isDimError = /dimension/i.test(message);
    console.error('[vector-db] Pinecone upsert failed.', {
      index: indexName,
      namespace: POST_MORTEMS_NAMESPACE,
      dimension: EMBEDDING_DIM,
      error: message,
      hint: isDimError
        ? 'Check that PINECONE_EMBEDDING_DIM matches the index dimension (e.g., llama-text-embed-v2 is often 1024 or 3072).'
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
    const queryVector = mockEmbed(`symbol ${symbol} trade post-mortem`);
    const result = await index.namespace(POST_MORTEMS_NAMESPACE).query({
      vector: queryVector,
      topK: Math.min(topK, 10),
      includeMetadata: true,
    });
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
      dimension: EMBEDDING_DIM,
      error: message,
      hint: isDimError
        ? 'Check that PINECONE_EMBEDDING_DIM matches the index dimension (e.g., llama-text-embed-v2 is often 1024 or 3072).'
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
    const values = mockEmbed(mergedSummary);
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIM) {
      throw new Error(`Embedding dimension mismatch (${values.length} !== ${EMBEDDING_DIM})`);
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
    console.log('[vector-db] Upserted board meeting memory to Pinecone.', {
      index: indexName,
      namespace: BOARD_MEETINGS_NAMESPACE,
      symbol: input.symbol,
    });
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
    const vector = mockEmbed(text);
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
