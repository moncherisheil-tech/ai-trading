'use client';

import { useState } from 'react';
import { Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function SimulateBtcButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    sentiment_score?: number;
    market_narrative?: string;
    direction?: string;
    probability?: number;
    error?: string;
  } | null>(null);

  const runSimulation = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/ops/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'BTC' }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setResult({
          success: true,
          sentiment_score: data.data.sentiment_score,
          market_narrative: data.data.market_narrative,
          direction: data.data.predicted_direction,
          probability: data.data.probability,
        });
      } else {
        setResult({ success: false, error: data.error || 'Simulation failed.' });
      }
    } catch (e) {
      setResult({ success: false, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Live BTC Simulation</span>
        <button
          type="button"
          onClick={runSimulation}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white px-3 py-2 text-sm font-medium transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? 'Running…' : 'Run BTC Simulation'}
        </button>
      </div>
      {result && (
        <div className={`rounded-lg p-3 text-sm ${result.success ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
          {result.success ? (
            <>
              <div className="flex items-center gap-2 text-emerald-800 font-medium mb-2">
                <CheckCircle2 className="w-4 h-4" /> Prediction saved
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-700">
                <span className="text-slate-500">Direction:</span><span className="font-semibold">{result.direction}</span>
                <span className="text-slate-500">Probability:</span><span>{result.probability}%</span>
                <span className="text-slate-500">Sentiment:</span><span>{typeof result.sentiment_score === 'number' ? result.sentiment_score.toFixed(2) : 'n/a'}</span>
                {result.market_narrative && (
                  <>
                    <span className="text-slate-500 col-span-2">Narrative:</span>
                    <p className="col-span-2 text-slate-600 line-clamp-2" title={result.market_narrative}>{result.market_narrative}</p>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-2">Check the main Analyzer page for Sentiment Badge and Risk Status.</p>
            </>
          ) : (
            <div className="flex items-start gap-2 text-red-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{result.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
