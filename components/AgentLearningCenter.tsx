'use client';

import { useState, useEffect } from 'react';
import { Brain, TrendingUp, TrendingDown, Loader2, RefreshCw } from 'lucide-react';
import { formatDateTimeLocal } from '@/lib/i18n';

export type AgentInsightItem = {
  id: number;
  symbol: string;
  trade_id: number;
  entry_conditions: string | null;
  outcome: string | null;
  insight: string;
  created_at: string;
  /** God-Mode: Why did this trade win/lose (for RAG). */
  why_win_lose?: string | null;
  /** God-Mode: Which agent was right/wrong. */
  agent_verdict?: string | null;
};

function parseOutcome(outcome: string | null): 'success' | 'fail' | 'unknown' {
  if (!outcome) return 'unknown';
  const lower = outcome.toLowerCase();
  if (lower.includes('reason=take_profit') || lower.includes('take_profit')) return 'success';
  if (lower.includes('stop_loss') || lower.includes('liquidation')) return 'fail';
  const pctMatch = outcome.match(/pnl_pct=([-\d.]+)/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    if (pct > 0) return 'success';
    if (pct < 0) return 'fail';
  }
  return 'unknown';
}

type AgentLearningCenterProps = {
  /** Optional date range — when set, insights are fetched for same period as CEO Briefing / report (sync). */
  fromDate?: string;
  toDate?: string;
};

export default function AgentLearningCenter({ fromDate, toDate }: AgentLearningCenterProps) {
  const [insights, setInsights] = useState<AgentInsightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const url =
        fromDate && toDate
          ? `/api/agent/insights?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`
          : '/api/agent/insights';
      const res = await fetch(url);
      const json = await res.json();
      if (json.success && Array.isArray(json.insights)) {
        setInsights(json.insights);
      } else {
        setInsights([]);
        if (!res.ok) setError('טעינת תובנות נכשלה.');
      }
    } catch {
      setInsights([]);
      setError('שגיאה בחיבור לשרת.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const url =
          fromDate && toDate
            ? `/api/agent/insights?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`
            : '/api/agent/insights';
        const res = await fetch(url);
        const json = await res.json();
        if (cancelled) return;
        if (json.success && Array.isArray(json.insights)) {
          setInsights(json.insights);
        } else {
          setInsights([]);
          if (!res.ok) setError('טעינת תובנות נכשלה.');
        }
      } catch {
        if (!cancelled) { setInsights([]); setError('שגיאה בחיבור לשרת.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

  if (loading && insights.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#111111] overflow-hidden min-w-0" dir="rtl">
        <h3 className="text-sm font-bold text-white px-6 py-4 border-b border-white/5 flex items-center gap-2">
          <Brain className="w-4 h-4 text-amber-500" />
          מרכז למידה של הסוכן
        </h3>
        <div className="p-8 flex items-center justify-center gap-2 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>טוען תובנות...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-[#111111] overflow-hidden min-w-0" dir="rtl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Brain className="w-4 h-4 text-amber-500" />
          מרכז למידה של הסוכן
        </h3>
        <button
          type="button"
          onClick={fetchInsights}
          disabled={loading}
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          aria-label="רענן תובנות"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && (
        <div className="px-6 py-3 text-amber-500 text-sm border-b border-white/5">
          {error}
        </div>
      )}
      <div className="overflow-y-auto max-h-[60vh] min-h-[200px]">
        {insights.length === 0 && !loading ? (
          <div className="p-8 text-center text-zinc-500 text-sm">
            אין עדיין תובנות. סגירת עסקאות סוכן תיצור תחקיר פוסט-מורטם כאן.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {insights.map((item) => {
              const outcome = parseOutcome(item.outcome);
              const isSuccess = outcome === 'success';
              const borderClass = isSuccess
                ? 'border-emerald-500/40 bg-emerald-500/5'
                : outcome === 'fail'
                  ? 'border-rose-500/40 bg-rose-500/5'
                  : 'border-white/10 bg-white/[0.02]';
              return (
                <li key={item.id} className={`px-6 py-4 border-s-4 ${borderClass} transition-colors hover:bg-white/[0.03]`}>
                  <div className="flex flex-wrap items-center gap-2 gap-y-1 mb-2">
                    <span className="font-semibold text-white">{item.symbol.replace('USDT', '')}</span>
                    <span className="text-xs text-zinc-500 tabular-nums" suppressHydrationWarning>
                      {formatDateTimeLocal(item.created_at)}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-medium">
                      {outcome === 'success' && (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <TrendingUp className="w-3.5 h-3.5" /> הצלחה
                        </span>
                      )}
                      {outcome === 'fail' && (
                        <span className="inline-flex items-center gap-1 text-rose-400">
                          <TrendingDown className="w-3.5 h-3.5" /> כישלון
                        </span>
                      )}
                      {outcome === 'unknown' && (
                        <span className="text-zinc-500">סיום</span>
                      )}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed break-words">
                    {item.insight}
                  </p>
                  {(item.why_win_lose || item.agent_verdict) && (
                    <div className="mt-2 pt-2 border-t border-white/5 space-y-1 text-xs text-zinc-400">
                      {item.why_win_lose && (
                        <p><span className="text-amber-500/90 font-medium">למה ניצח/הפסיד:</span> {item.why_win_lose}</p>
                      )}
                      {item.agent_verdict && (
                        <p><span className="text-amber-500/90 font-medium">איזה סוכן צדק/טעה:</span> {item.agent_verdict}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
