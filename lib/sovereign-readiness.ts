import { verifyPineconeConnectionStrict } from '@/lib/vector-db';

export type ReadinessFactor = {
  id: string;
  label: string;
  weight: number;
  score: number;
  ok: boolean;
  detail?: string;
};

export type SovereignReadiness = {
  score: number;
  factors: ReadinessFactor[];
};

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * CEO Terminal readiness: infra + embedding-001 probe + optional TS CI flag.
 */
export async function computeSovereignReadiness(params: {
  settingsLoadOk: boolean;
  embeddingProbeOk: boolean;
  embeddingDetail?: string;
  tsClean: 'pass' | 'fail' | 'unknown';
}): Promise<SovereignReadiness> {
  let pineconeScore = 0;
  let pineconeDetail = '';
  const hasPc = Boolean(process.env.PINECONE_API_KEY?.trim() && process.env.PINECONE_INDEX_NAME?.trim());
  if (!hasPc) {
    pineconeScore = 20;
    pineconeDetail = 'Pinecone optional — not configured (full credit).';
  } else {
    const pc = await verifyPineconeConnectionStrict();
    if (pc.ok) {
      pineconeScore = 20;
      pineconeDetail = `Index ${pc.index ?? 'ok'}`;
    } else {
      pineconeScore = 0;
      pineconeDetail = pc.error ?? 'Pinecone connection failed.';
    }
  }

  const tsScore =
    params.tsClean === 'pass' ? 25 : params.tsClean === 'unknown' ? 12 : 0;
  const tsDetail =
    params.tsClean === 'pass'
      ? 'TYPECHECK_PASSED=1'
      : params.tsClean === 'unknown'
        ? 'Set TYPECHECK_PASSED=1 in CI after tsc --noEmit.'
        : 'TYPECHECK_PASSED=0 — fix TypeScript errors.';

  const factors: ReadinessFactor[] = [
    {
      id: 'database',
      label: 'Database / settings',
      weight: 15,
      score: params.settingsLoadOk ? 15 : 0,
      ok: params.settingsLoadOk,
      detail: params.settingsLoadOk ? 'App settings loaded.' : 'Failed to load settings.',
    },
    {
      id: 'embedding004',
      label: 'Embeddings (embedding-001)',
      weight: 25,
      score: params.embeddingProbeOk ? 25 : 0,
      ok: params.embeddingProbeOk,
      detail: params.embeddingDetail ?? (params.embeddingProbeOk ? '768-dim path OK.' : 'Probe failed.'),
    },
    {
      id: 'pinecone',
      label: 'Deep memory (Pinecone)',
      weight: 20,
      score: pineconeScore,
      ok: pineconeScore >= 20,
      detail: pineconeDetail,
    },
    {
      id: 'typescript',
      label: 'TypeScript (CI)',
      weight: 25,
      score: tsScore,
      ok: params.tsClean === 'pass',
      detail: tsDetail,
    },
    {
      id: 'reserve',
      label: 'Operational buffer',
      weight: 15,
      score: params.settingsLoadOk && params.embeddingProbeOk ? 15 : 8,
      ok: params.settingsLoadOk && params.embeddingProbeOk,
      detail: 'Reserved for stable core paths.',
    },
  ];

  const earned = factors.reduce((s, f) => s + f.score, 0);
  const score = clampScore(earned);

  return { score, factors };
}

export function resolveTypecheckStatus(): 'pass' | 'fail' | 'unknown' {
  const raw = process.env.TYPECHECK_PASSED?.trim();
  if (raw === '1' || raw?.toLowerCase() === 'true') return 'pass';
  if (raw === '0' || raw?.toLowerCase() === 'false') return 'fail';
  return 'unknown';
}
