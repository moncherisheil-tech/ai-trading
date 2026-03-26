import { getExecutionDashboardSnapshot } from '@/lib/trading/execution-engine';
import { getAppSettings } from '@/lib/db/app-settings';
import { probeGeminiEmbedding } from '@/lib/vector-db';
import { computeSovereignReadiness, resolveTypecheckStatus } from '@/lib/sovereign-readiness';
import { evaluateGoLiveSafety } from '@/lib/go-live-safety';

export type AdminTerminalFeedPayload = {
  snapshot: Awaited<ReturnType<typeof getExecutionDashboardSnapshot>>;
  neural: Awaited<ReturnType<typeof getAppSettings>>['neural'];
  execution: Awaited<ReturnType<typeof getAppSettings>>['execution'];
  readiness: Awaited<ReturnType<typeof computeSovereignReadiness>>;
  goLiveSafety: ReturnType<typeof evaluateGoLiveSafety>;
  fetchedAt: string;
};

export async function buildAdminTerminalFeedPayload(): Promise<AdminTerminalFeedPayload> {
  const [snapshot, settings, embedProbe] = await Promise.all([
    getExecutionDashboardSnapshot(),
    getAppSettings(),
    probeGeminiEmbedding(),
  ]);

  const readiness = await computeSovereignReadiness({
    settingsLoadOk: true,
    embeddingProbeOk: embedProbe.ok,
    embeddingDetail: embedProbe.ok
      ? `gemini-embedding-001 dim=${embedProbe.dimension}`
      : embedProbe.error,
    tsClean: resolveTypecheckStatus(),
  });

  const goLiveSafety = evaluateGoLiveSafety(settings);

  return {
    snapshot,
    neural: settings.neural,
    execution: settings.execution,
    readiness,
    goLiveSafety,
    fetchedAt: new Date().toISOString(),
  };
}
