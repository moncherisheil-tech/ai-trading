'use client';

import { useEffect, useState } from 'react';

type OlympusBoardTelemetry = {
  marketRegime: string;
  activeBoardWeights: Record<string, number>;
  modelWatchdog: {
    gemini?: { status?: string };
    groq?: { status?: string };
  } | null;
};

type LiveProviderHealth = {
  gemini: { status: string; failureRatePct: number; p95LatencyMs: number };
  groq: { status: string; failureRatePct: number; p95LatencyMs: number };
  timestamp: string;
} | null;

function badgeTone(status: string | undefined): string {
  if (status === 'unstable') return 'border-rose-500/40 text-rose-300';
  if (status === 'degraded') return 'border-amber-500/40 text-amber-300';
  return 'border-emerald-500/35 text-emerald-300';
}

/**
 * Olympus Neural Board Weights panel.
 *
 * The `olympusBoard` prop comes from DB execution history — its `modelWatchdog` field is a
 * STALE SNAPSHOT from the last saved consensus run and should NOT be trusted for real-time
 * health. This component fetches /api/ops/provider-health independently to show live status.
 */
export default function ActiveBoardWeightsPanel({ olympusBoard }: { olympusBoard: OlympusBoardTelemetry }) {
  const entries = Object.entries(olympusBoard.activeBoardWeights).sort((a, b) => b[1] - a[1]);

  // Live provider health — overrides the stale modelWatchdog baked into the DB snapshot.
  const [liveHealth, setLiveHealth] = useState<LiveProviderHealth>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/ops/provider-health', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as LiveProviderHealth;
        if (!cancelled) setLiveHealth(data);
      } catch {
        // Non-fatal — fall back to the DB snapshot status below
      }
    };

    void fetchHealth();
    // Refresh every 30 seconds so the badge reacts when a new consensus run completes.
    const interval = setInterval(() => { void fetchHealth(); }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Prefer live health; fall back to the stale DB snapshot only when the live fetch hasn't returned yet.
  const geminiStatus = liveHealth?.gemini?.status ?? olympusBoard.modelWatchdog?.gemini?.status;
  const groqStatus   = liveHealth?.groq?.status   ?? olympusBoard.modelWatchdog?.groq?.status;

  // Stale-data warning: show a badge when we're still displaying the DB snapshot's watchdog.
  const usingStaleWatchdog = liveHealth === null;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 xl:col-span-2" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">Olympus Neural Board Weights</h3>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {usingStaleWatchdog && (
            <span className="rounded border border-slate-600 px-2 py-0.5 text-slate-500 italic">
              snapshot
            </span>
          )}
          <span className="rounded border border-slate-700 px-2 py-0.5 tabular-nums">
            Regime: {olympusBoard.marketRegime || 'n/a'}
          </span>
          <span className={`rounded border px-2 py-0.5 tabular-nums ${badgeTone(geminiStatus)}`}>
            Gemini {geminiStatus ?? 'healthy'}
          </span>
          <span className={`rounded border px-2 py-0.5 tabular-nums ${badgeTone(groqStatus)}`}>
            Groq {groqStatus ?? 'healthy'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {entries.map(([key, weight]) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">{key}</span>
              <span className={`tabular-nums font-semibold ${weight >= 20 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {weight.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full ${weight >= 20 ? 'bg-emerald-400' : 'bg-rose-400'} transition-all duration-500`}
                style={{ width: `${Math.max(2, Math.min(100, weight))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
