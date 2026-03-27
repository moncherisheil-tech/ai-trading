'use client';

type OlympusBoardTelemetry = {
  marketRegime: string;
  activeBoardWeights: Record<string, number>;
  modelWatchdog: {
    gemini?: { status?: string };
    groq?: { status?: string };
  } | null;
};

function badgeTone(status: string | undefined): string {
  if (status === 'unstable') return 'border-rose-500/40 text-rose-300';
  if (status === 'degraded') return 'border-amber-500/40 text-amber-300';
  return 'border-emerald-500/35 text-emerald-300';
}

export default function ActiveBoardWeightsPanel({ olympusBoard }: { olympusBoard: OlympusBoardTelemetry }) {
  const entries = Object.entries(olympusBoard.activeBoardWeights).sort((a, b) => b[1] - a[1]);
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 xl:col-span-2" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">Olympus Neural Board Weights</h3>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="rounded border border-slate-700 px-2 py-0.5 tabular-nums">
            Regime: {olympusBoard.marketRegime || 'n/a'}
          </span>
          <span className={`rounded border px-2 py-0.5 tabular-nums ${badgeTone(olympusBoard.modelWatchdog?.gemini?.status)}`}>
            Gemini {olympusBoard.modelWatchdog?.gemini?.status ?? 'healthy'}
          </span>
          <span className={`rounded border px-2 py-0.5 tabular-nums ${badgeTone(olympusBoard.modelWatchdog?.groq?.status)}`}>
            Groq {olympusBoard.modelWatchdog?.groq?.status ?? 'healthy'}
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

