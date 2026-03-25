'use client';

import { useState, useCallback } from 'react';
import { Sliders, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAppSettings } from '@/context/AppSettingsContext';
import type { AppSettings } from '@/lib/db/app-settings';

export type CalibrationApiResult = {
  success: boolean;
  currentParams: {
    defaultTakeProfitPct: number;
    defaultStopLossPct: number;
    defaultPositionSizeUsd: number;
    minVolume24hUsd?: number;
    aiConfidenceThreshold?: number;
  };
  suggestedParams: {
    defaultTakeProfitPct: number;
    defaultStopLossPct: number;
    defaultPositionSizeUsd: number;
  };
  bestSharpe: number;
  bestProfitFactor: number;
  marketContext: string;
  recommendation_he: string;
  market_context_note?: string;
  tradesAnalyzed: number;
  fromDate: string;
  toDate: string;
};

type SystemOptimizationCardProps = {
  onApplied?: (settings: Partial<AppSettings>) => void;
};

export default function SystemOptimizationCard({ onApplied }: SystemOptimizationCardProps) {
  const toast = useToast();
  const { refreshSettings } = useAppSettings();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<CalibrationApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCalibration = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/ops/calibrate', { credentials: 'include' });
      const data = (await res.json()) as CalibrationApiResult & { error?: string };
      if (!res.ok) {
        setError(data?.error ?? 'שגיאה בהרצת כיול');
        return;
      }
      if (data.success) setResult(data);
      else setError(data?.error ?? 'לא התקבלו המלצות');
    } catch {
      setError('שגיאת רשת — לא ניתן להריץ כיול');
    } finally {
      setLoading(false);
    }
  }, []);

  const applyCalibration = useCallback(async () => {
    if (!result?.suggestedParams || applying) return;
    setApplying(true);
    try {
      const body = {
        risk: {
          defaultTakeProfitPct: result.suggestedParams.defaultTakeProfitPct,
          defaultStopLossPct: result.suggestedParams.defaultStopLossPct,
          defaultPositionSizeUsd: result.suggestedParams.defaultPositionSizeUsd,
        },
      } as { risk: Partial<NonNullable<AppSettings['risk']>> };
      const res = await fetch('/api/settings/app', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        toast.success('סכימת הכיול הוחלה. הפרמטרים עודכנו.');
        await refreshSettings();
        onApplied?.(body as Partial<AppSettings>);
      } else {
        toast.error(json?.error ?? 'שגיאה בהחלת כיול');
      }
    } catch {
      toast.error('שגיאת רשת בהחלת כיול');
    } finally {
      setApplying(false);
    }
  }, [result, applying, toast, onApplied, refreshSettings]);

  return (
    <section
      className="mb-6 sm:mb-8 p-4 sm:p-6 rounded-2xl border border-slate-700 bg-slate-800/80"
      aria-label="כיול מערכת אוטונומי — אופטימיזציית פרמטרים"
      dir="rtl"
    >
      <h2 className="text-lg font-semibold text-slate-200 mb-3 flex items-center gap-2">
        <Sliders className="w-5 h-5 text-emerald-400" aria-hidden />
        כיול מערכת אוטונומי
      </h2>
      <p className="text-sm text-slate-400 mb-4">
        ניתוח רגישות על 14 הימים האחרונים — אופטימיזציית פרמטרים למקסום שרפ ומקדם רווח. נקודת איזון אופטימלית לפי סימולציות.
      </p>

      {!result && !loading && !error && (
        <button
          type="button"
          onClick={runCalibration}
          className="rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 px-4 py-2.5 text-sm font-semibold hover:bg-emerald-500/30 transition-colors flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          הרץ ניתוח רגישות
        </button>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-4 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>מריץ ניתוח רגישות...</span>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 flex items-center gap-2 text-amber-200">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
          <button
            type="button"
            onClick={runCalibration}
            className="mr-auto text-sm underline hover:no-underline"
          >
            נסה שוב
          </button>
        </div>
      )}

      {result && !loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="rounded-xl border border-slate-600 bg-slate-900/60 p-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">פרמטרים נוכחיים</h3>
              <ul className="space-y-1.5 text-sm">
                <li className="flex justify-between">
                  <span className="text-slate-400">יעד רווח (TP)</span>
                  <span className="text-slate-100 font-medium">{result.currentParams.defaultTakeProfitPct}%</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-400">סטופ־לוס (SL)</span>
                  <span className="text-slate-100 font-medium">{result.currentParams.defaultStopLossPct}%</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-400">גודל פוזיציה</span>
                  <span className="text-slate-100 font-medium">${result.currentParams.defaultPositionSizeUsd}</span>
                </li>
              </ul>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
              <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">פרמטרים מוצעים</h3>
              <ul className="space-y-1.5 text-sm">
                <li className="flex justify-between">
                  <span className="text-slate-300">יעד רווח (TP)</span>
                  <span className="text-emerald-300 font-medium">{result.suggestedParams.defaultTakeProfitPct}%</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-300">סטופ־לוס (SL)</span>
                  <span className="text-emerald-300 font-medium">{result.suggestedParams.defaultStopLossPct}%</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-slate-300">גודל פוזיציה</span>
                  <span className="text-emerald-300 font-medium">${result.suggestedParams.defaultPositionSizeUsd}</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-3 text-xs text-slate-400">
            <span>שרפ אופטימלי: <strong className="text-slate-200">{result.bestSharpe.toFixed(2)}</strong></span>
            <span>•</span>
            <span>מקדם רווח: <strong className="text-slate-200">{result.bestProfitFactor.toFixed(2)}</strong></span>
            <span>•</span>
            <span>עסקאות בניתוח: {result.tradesAnalyzed}</span>
            {result.marketContext && result.marketContext !== 'normal' && (
              <>
                <span>•</span>
                <span className="text-amber-400">הקשר שוק: {result.marketContext === 'high_volatility' ? 'תנודתיות גבוהה' : 'תנודתיות נמוכה'}</span>
              </>
            )}
          </div>

          {result.market_context_note && (
            <p className="text-sm text-amber-200/90 mb-3 p-2 rounded-lg bg-amber-950/20 border border-amber-500/20">
              {result.market_context_note}
            </p>
          )}

          {result.recommendation_he && (
            <p className="text-sm text-slate-300 mb-4 whitespace-pre-wrap">{result.recommendation_he}</p>
          )}

          <button
            type="button"
            onClick={applyCalibration}
            disabled={applying}
            className="rounded-xl bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 px-4 py-2.5 text-sm font-semibold hover:bg-emerald-500/40 transition-colors flex items-center gap-2 disabled:opacity-70"
          >
            {applying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            החל סכימת כיול
          </button>
        </>
      )}
    </section>
  );
}
