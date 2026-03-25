'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, Play, Loader2 } from 'lucide-react';
import { runOpsSandboxAction } from '@/app/actions';

type RunResponse = {
  ok: boolean;
  alphaSignalId?: string;
  consensus?: { final_confidence: number; consensus_approved: boolean; master_insight_he: string };
  llmRaw?: { anthropic: string; groq: string; gemini: string };
  error?: string;
};

const CHECKS = [
  'Technical Analyst',
  'Fundamental Analyst',
  'Sentiment Analyst',
  'On-Chain Analyst',
  'Risk Manager',
  'Macro Analyst',
  'AI Overseer',
];

export default function OpsSandboxPage() {
  const [activeIndex, setActiveIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResponse | null>(null);

  const completeCount = useMemo(() => (activeIndex < 0 ? 0 : Math.min(activeIndex + 1, CHECKS.length)), [activeIndex]);

  const runSimulation = async () => {
    setRunning(true);
    setResult(null);
    setActiveIndex(-1);

    try {
      const out = await runOpsSandboxAction();
      const json = out.success ? (out.data as RunResponse) : ({ ok: false, error: out.error } as RunResponse);
      setResult(json);
      setActiveIndex(json.ok ? CHECKS.length - 1 : -1);
    } catch (error) {
      setResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
      setActiveIndex(-1);
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6" dir="ltr">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Ops Sandbox — Perfect Run QA</h1>
        <p className="text-zinc-400 text-sm">
          Local-only QA route. Uses cached DB context, cached Leviathan fixture, and pre-recorded LLM payloads while executing real consensus logic and DB save.
        </p>

        <button
          type="button"
          disabled={running}
          onClick={runSimulation}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Run Perfect Run Simulation
        </button>

        <section className="grid gap-2">
          {CHECKS.map((name, idx) => {
            const checked = idx <= activeIndex;
            return (
              <div key={name} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
                {checked ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Circle className="w-4 h-4 text-zinc-600" />}
                <span className={checked ? 'text-emerald-300' : 'text-zinc-300'}>{name}</span>
              </div>
            );
          })}
        </section>

        <p className="text-xs text-zinc-500">Progress: {completeCount}/{CHECKS.length}</p>

        {result && (
          <section className={`rounded-lg border p-4 ${result.ok ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-red-500/40 bg-red-950/20'}`}>
            {result.ok ? (
              <div className="space-y-2 text-sm">
                <p className="text-emerald-300 font-medium">Simulation completed and alpha signal saved to DB.</p>
                <p>Alpha Signal ID: <span className="font-mono">{result.alphaSignalId}</span></p>
                <p>Final Confidence: {result.consensus?.final_confidence ?? 'N/A'}</p>
                <p>Consensus Approved: {String(result.consensus?.consensus_approved ?? false)}</p>
                <p className="text-zinc-300">Overseer: {result.consensus?.master_insight_he}</p>
              </div>
            ) : (
              <p className="text-red-300">Simulation failed: {result.error || 'Unknown error'}</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
