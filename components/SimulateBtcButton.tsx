'use client';

import { useState } from 'react';
import { Play, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { getT } from '@/lib/i18n';
import { runOpsSimulationAction } from '@/app/actions';

const t = getT('he');

type SimulationActionPayload = {
  success?: boolean;
  error?: string;
  data?: {
    sentiment_score?: number;
    market_narrative?: string;
    predicted_direction?: string;
    probability?: number;
  };
};

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
      const out = await runOpsSimulationAction({ symbol: 'BTC' });
      const data = out.success ? ((out.data ?? null) as SimulationActionPayload | null) : null;
      if (out.success && data?.success && data?.data) {
        setResult({
          success: true,
          sentiment_score: data.data.sentiment_score,
          market_narrative: data.data.market_narrative,
          direction: data.data.predicted_direction,
          probability: data.data.probability,
        });
      } else {
        const rawError = out.success ? (data?.error as string | undefined) : undefined;
        const isValidationError =
          typeof rawError === 'string' &&
          (rawError.includes('ZodError') || rawError.includes('validation') || rawError.includes('אימות'));
        setResult({
          success: false,
          error: isValidationError
            ? 'שגיאה באימות הנתונים. נסה שוב.'
            : out.success
              ? rawError || 'הסימולציה נכשלה.'
              : String(out.error ?? '').includes('504')
                ? 'השרת עמוס, מבצע אופטימיזציה אוטומטית... נסה שוב'
                : out.error || 'הסימולציה נכשלה.',
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'שגיאת רשת';
      setResult({ success: false, error: msg === 'Failed to fetch' || String(msg).includes('timeout') ? 'השרת עמוס, מבצע אופטימיזציה אוטומטית... נסה שוב' : msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/80 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-300">סימולציית BTC בשידור חי</span>
        <button
          type="button"
          onClick={runSimulation}
          disabled={loading}
          aria-label={loading ? 'מנתח נתונים' : 'הרץ סימולציית BTC בשידור חי'}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? 'מנתח נתונים…' : 'הרץ סימולציית BTC'}
        </button>
      </div>
      {result && (
        <div className={`rounded-lg p-3 text-sm ${result.success ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200' : 'bg-red-500/10 border border-red-500/30 text-red-200'}`}>
          {result.success ? (
            <>
              <div className="flex items-center gap-2 font-medium mb-2 text-emerald-300">
                <CheckCircle2 className="w-4 h-4" /> תחזית נשמרה
              </div>
              <div className="grid grid-cols-2 gap-2 text-slate-300">
                <span className="text-slate-400">כיוון:</span><span className="font-semibold">{result.direction}</span>
                <span className="text-slate-400">הסתברות:</span><span>{result.probability}%</span>
                <span className="text-slate-400">סנטימנט:</span><span>{typeof result.sentiment_score === 'number' ? result.sentiment_score.toFixed(2) : '—'}</span>
                {result.market_narrative && (
                  <>
                    <span className="text-slate-400 col-span-2">נרטיב:</span>
                    <p className="col-span-2 text-slate-300 line-clamp-2" title={result.market_narrative}>{result.market_narrative}</p>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-2">בדוק בדף הניתוח הראשי את סטטוס הסנטימנט והסיכון.</p>
            </>
          ) : (
            <div className="flex items-start gap-2 text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{result.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
