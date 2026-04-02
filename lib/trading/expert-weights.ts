import { sql } from '@/lib/db/sql';
import { APP_CONFIG } from '@/lib/config';

export interface ExpertWeights {
  dataExpertWeight: number;
  newsExpertWeight: number;
  macroExpertWeight: number;
}

export const DEFAULT_EXPERT_WEIGHTS: ExpertWeights = {
  dataExpertWeight: 1.0,
  newsExpertWeight: 1.0,
  macroExpertWeight: 1.0,
};

const MIN_WEIGHT = 0.2;
const MAX_WEIGHT = 2.0;
const CACHE_TTL_MS = 5_000;
const SINGLETON_ID = 1;

let weightsCache: { data: ExpertWeights; expiresAt: number } | null = null;

function usePostgres(): boolean {
  return Boolean(APP_CONFIG.postgresUrl?.trim());
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, value));
}

export async function getExpertWeights(): Promise<ExpertWeights> {
  const now = Date.now();
  if (weightsCache && weightsCache.expiresAt > now) return weightsCache.data;
  if (!usePostgres()) return { ...DEFAULT_EXPERT_WEIGHTS };
  try {
    const { rows } = await sql`
      SELECT
        data_expert_weight::float AS data_expert_weight,
        news_expert_weight::float AS news_expert_weight,
        macro_expert_weight::float AS macro_expert_weight
      FROM expert_weights
      WHERE id = ${SINGLETON_ID}
      LIMIT 1
    `;
    const row = rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return { ...DEFAULT_EXPERT_WEIGHTS };
    const data = {
      dataExpertWeight: clampWeight(Number(row.data_expert_weight)),
      newsExpertWeight: clampWeight(Number(row.news_expert_weight)),
      macroExpertWeight: clampWeight(Number(row.macro_expert_weight)),
    };
    weightsCache = { data, expiresAt: now + CACHE_TTL_MS };
    return data;
  } catch (err) {
    console.error('getExpertWeights failed:', err);
    return { ...DEFAULT_EXPERT_WEIGHTS };
  }
}

export async function updateExpertWeights(next: ExpertWeights, reason?: string): Promise<ExpertWeights> {
  const sanitized: ExpertWeights = {
    dataExpertWeight: clampWeight(next.dataExpertWeight),
    newsExpertWeight: clampWeight(next.newsExpertWeight),
    macroExpertWeight: clampWeight(next.macroExpertWeight),
  };
  if (!usePostgres()) {
    weightsCache = { data: sanitized, expiresAt: Date.now() + CACHE_TTL_MS };
    return sanitized;
  }
  try {
    await sql`
      UPDATE expert_weights
      SET
        data_expert_weight = ${sanitized.dataExpertWeight},
        news_expert_weight = ${sanitized.newsExpertWeight},
        macro_expert_weight = ${sanitized.macroExpertWeight},
        updated_at = NOW(),
        updated_reason = ${reason ?? null}
      WHERE id = ${SINGLETON_ID}
    `;
    weightsCache = { data: sanitized, expiresAt: Date.now() + CACHE_TTL_MS };
    return sanitized;
  } catch (err) {
    console.error('updateExpertWeights failed:', err);
    return sanitized;
  }
}

export async function applyExpertWeightDeltas(
  deltas: Partial<ExpertWeights>,
  reason?: string
): Promise<ExpertWeights> {
  const current = await getExpertWeights();
  return updateExpertWeights(
    {
      dataExpertWeight: current.dataExpertWeight + (deltas.dataExpertWeight ?? 0),
      newsExpertWeight: current.newsExpertWeight + (deltas.newsExpertWeight ?? 0),
      macroExpertWeight: current.macroExpertWeight + (deltas.macroExpertWeight ?? 0),
    },
    reason
  );
}
