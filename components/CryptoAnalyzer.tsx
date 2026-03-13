'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import dynamic from 'next/dynamic';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  AlertTriangle,
  Lightbulb,
  BarChart2,
  Zap,
  Loader2,
  RefreshCw,
  Database,
  CheckCircle2,
  Clock,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
} from 'lucide-react';
import { analyzeCrypto, getHistory, evaluatePendingPredictions } from '@/app/actions';
import type { PredictionRecord } from '@/lib/db';
import { useLocale } from '@/hooks/use-locale';
import { useSimulation, INITIAL_WALLET_USD } from '@/context/SimulationContext';
import { toSymbol } from '@/lib/symbols';
import SymbolSelect from '@/components/SymbolSelect';

const PriceHistoryChart = dynamic(() => import('@/components/PriceHistoryChart'));

const DIRECTION_HE: Record<string, string> = {
  Bullish: 'שורי',
  Bearish: 'דובי',
  Neutral: 'ניטרלי',
};

export default function CryptoAnalyzer() {
  const { t } = useLocale();
  const {
    selectedSymbol,
    setSelectedSymbol,
    walletUsd,
    addTrade,
    resetSimulation,
    getMarkersForSymbol,
    getTradesForSymbol,
  } = useSimulation();

  const symbol = useMemo(() => `${selectedSymbol}USDT`, [selectedSymbol]);

  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PredictionRecord[]>([]);
  const [chartData, setChartData] = useState<{ date: string; close: number }[]>([]);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
  const [historyScrollTop, setHistoryScrollTop] = useState(0);
  const [formRenderedAt, setFormRenderedAt] = useState<number>(Date.now());
  const [honeypot, setHoneypot] = useState('');
  const [simAmountUsd, setSimAmountUsd] = useState('');
  const [simError, setSimError] = useState<string | null>(null);
  const [gemBaseSymbols, setGemBaseSymbols] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/crypto/gems')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { symbol?: string }[]) => {
        if (cancelled || !Array.isArray(data)) return;
        const bases = data.map((t) => String(t.symbol || '').replace('USDT', '')).filter(Boolean);
        setGemBaseSymbols(bases.length > 0 ? bases : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const loadHistory = async () => {
    const data = await getHistory();
    setHistory(data);
  };

  useEffect(() => {
    loadHistory().catch(() => {
      setError(t.loadHistoryError);
    });
  }, [t.loadHistoryError]);

  useEffect(() => {
    setFormRenderedAt(Date.now());
  }, [selectedSymbol]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'enter') {
        event.preventDefault();
        if (!loading) {
          void handleAnalyze(event as unknown as React.FormEvent);
        }
      }
      if (event.altKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        if (!evaluating) {
          void handleEvaluate();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loading, evaluating, selectedSymbol]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSimError(null);
    setChartData([]);
    const res = await analyzeCrypto({
      symbol,
      honeypot,
      submittedAt: formRenderedAt,
      captchaToken: '',
    });
    if (res.success) {
      if (res.chartData?.length) {
        setChartData(
          res.chartData.map((d) => ({
            date: d.date,
            close: d.close,
          }))
        );
      }
      await loadHistory();
    } else {
      setError(res.error || t.analysisErrorDefault);
    }
    setLoading(false);
  };

  const handleEvaluate = async () => {
    setEvaluating(true);
    const res = await evaluatePendingPredictions();
    if (res.success) await loadHistory();
    setEvaluating(false);
  };

  const latestPrediction = history.length > 0 ? history[0] : null;
  const currentPrice = latestPrediction?.entry_price ?? 0;
  const visibleHistory = history.slice(0, visibleHistoryCount);
  const repairedCount = history.filter((r) => r.validation_repaired).length;
  const fallbackCount = history.filter((r) => r.fallback_used).length;
  const withSourcesCount = history.filter((r) => (r.sources?.length ?? 0) > 0).length;
  const latencyRows = history.filter((r) => typeof r.latency_ms === 'number');
  const avgLatency =
    latencyRows.reduce((acc, r) => acc + (r.latency_ms || 0), 0) / Math.max(1, latencyRows.length);

  const executionMarkers = useMemo(() => getMarkersForSymbol(symbol), [getMarkersForSymbol, symbol]);
  const simulationTrades = useMemo(() => getTradesForSymbol(symbol), [getTradesForSymbol, symbol]);

  const handleSimBuy = () => {
    const amount = parseFloat(simAmountUsd);
    if (!Number.isFinite(amount) || amount <= 0 || currentPrice <= 0) {
      setSimError('סכום או מחיר לא תקינים.');
      return;
    }
    const result = addTrade(symbol, 'buy', currentPrice, amount);
    if (!result.success) {
      setSimError(
        result.error === 'INSUFFICIENT_FUNDS'
          ? 'אין מספיק יתרה בארנק הסימולציה לביצוע פעולה זו.'
          : result.error === 'INSUFFICIENT_ASSET'
            ? 'אין מספיק נכס זמין למכירה עבור סימולציה זו.'
            : 'הפעולה נכשלה. בדוק את הנתונים ונסה שוב.'
      );
      return;
    }
    setSimError(null);
    setSimAmountUsd('');
  };

  const handleSimSell = () => {
    const amount = parseFloat(simAmountUsd);
    if (!Number.isFinite(amount) || amount <= 0 || currentPrice <= 0) {
      setSimError('סכום או מחיר לא תקינים.');
      return;
    }
    const result = addTrade(symbol, 'sell', currentPrice, amount);
    if (!result.success) {
      setSimError(
        result.error === 'INSUFFICIENT_FUNDS'
          ? 'אין מספיק יתרה בארנק הסימולציה לביצוע פעולה זו.'
          : result.error === 'INSUFFICIENT_ASSET'
            ? 'אין מספיק נכס זמין למכירה עבור סימולציה זו.'
            : 'הפעולה נכשלה. בדוק את הנתונים ונסה שוב.'
      );
      return;
    }
    setSimError(null);
    setSimAmountUsd('');
  };

  const rowHeight = 132;
  const viewportHeight = 500;
  const overscan = 4;
  const totalRows = visibleHistory.length;
  const startIndex = Math.max(0, Math.floor(historyScrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    totalRows,
    Math.ceil((historyScrollTop + viewportHeight) / rowHeight) + overscan
  );
  const windowedRows = visibleHistory.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = Math.max(0, (totalRows - endIndex) * rowHeight);

  return (
    <div
      className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 min-w-0"
      dir="rtl"
    >
      {/* Currency switcher + Input */}
      <div className="lg:col-span-4 space-y-4 sm:space-y-6">
        {/* Multi-currency switcher */}
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-semibold text-slate-100">{t.newAnalysis}</h2>
          </div>
          <p className="text-sm text-slate-400 mb-3">בחר מטבע לניתוח ולסימולציה</p>
          <SymbolSelect
            value={selectedSymbol || 'BTC'}
            onChange={setSelectedSymbol}
            placeholder="בחר מטבע"
            gemBaseSymbols={gemBaseSymbols}
          />

          <form onSubmit={handleAnalyze} className="mt-5 space-y-4">
            <input
              type="text"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              className="hidden"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
            />
            <button
              type="submit"
              disabled={loading}
              aria-label="הרץ ניתוח כמותי"
              className="w-full min-h-[48px] py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed touch-manipulation"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {t.analyzing}
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  {t.runAnalysis} ({symbol})
                </>
              )}
            </button>
            <p className="text-xs text-slate-500">{t.keyboardHint}</p>
          </form>
        </div>

        {/* Simulation wallet & quick trade */}
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400">
                <Wallet className="w-5 h-5" />
              </div>
              <h2 className="text-base font-semibold text-slate-100">ארנק סימולציה</h2>
            </div>
            <button
              type="button"
              onClick={resetSimulation}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 touch-manipulation min-h-[44px]"
              title="איפוס לסימולציה חדשה"
            >
              <RotateCcw className="w-4 h-4" />
              איפוס
            </button>
          </div>
          <div className="text-2xl font-bold text-emerald-400 mb-1">
            ${walletUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-500 mb-4">יתרה התחלתית: ${INITIAL_WALLET_USD.toLocaleString()}</p>

          {latestPrediction && currentPrice > 0 && (
            <>
              <p className="text-sm text-slate-400 mb-2">מחיר נוכחי: ${currentPrice.toLocaleString()}</p>
              <div className="flex gap-2 flex-wrap">
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="סכום ב-USD"
                  value={simAmountUsd}
                  onChange={(e) => setSimAmountUsd(e.target.value)}
                  className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl bg-slate-700 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-emerald-500/50 touch-manipulation"
                  aria-label="סכום לרכישה או מכירה ב-USD"
                />
                <button
                  type="button"
                  onClick={handleSimBuy}
                  disabled={!simAmountUsd || parseFloat(simAmountUsd) <= 0}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm flex items-center gap-2 disabled:opacity-50 touch-manipulation"
                >
                  <ArrowUpCircle className="w-5 h-5" />
                  קנה
                </button>
                <button
                  type="button"
                  onClick={handleSimSell}
                  disabled={!simAmountUsd || parseFloat(simAmountUsd) <= 0}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium text-sm flex items-center gap-2 disabled:opacity-50 touch-manipulation"
                >
                  <ArrowDownCircle className="w-5 h-5" />
                  מכור
                </button>
              </div>
              {simError && (
                <p className="mt-2 text-xs text-red-400" role="status" aria-live="polite">
                  {simError}
                </p>
              )}
            </>
          )}
        </div>

        {/* Evaluate */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-3">
            <RefreshCw className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-slate-100">{t.feedbackLoop}</h2>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            אימות תחזיות ממתינות מול מחירי שוק נוכחיים.
          </p>
          <button
            onClick={handleEvaluate}
            disabled={evaluating}
            aria-label="הערך תחזיות עבר"
            className="w-full min-h-[44px] py-2.5 px-4 bg-slate-700 border border-slate-600 hover:bg-slate-600 text-slate-200 rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-70 touch-manipulation"
          >
            {evaluating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t.evaluating}
              </>
            ) : (
              <>
                <Database className="w-5 h-5" />
                {t.evaluate}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Output & History */}
      <div className="lg:col-span-8 space-y-6 min-w-0">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/10 border border-red-500/30 text-red-300 p-4 rounded-xl flex items-start gap-3"
            role="status"
            aria-live="polite"
          >
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">{error}</div>
          </motion.div>
        )}

        {latestPrediction ? (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-slate-400" />
              {t.latestPrediction}
            </h3>
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-800/80 border border-slate-700 rounded-2xl overflow-hidden"
            >
              <div
                className={`p-4 sm:p-6 border-b border-slate-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
                  latestPrediction.predicted_direction === 'Bullish'
                    ? 'bg-emerald-500/10'
                    : latestPrediction.predicted_direction === 'Bearish'
                      ? 'bg-red-500/10'
                      : 'bg-slate-700/30'
                }`}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <div>
                    <div className="text-sm text-slate-400 mb-1">תוצאה עבור</div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-slate-100">{latestPrediction.symbol}</h2>
                  </div>
                  {(latestPrediction.risk_status === 'extreme_fear' ||
                    latestPrediction.risk_status === 'extreme_greed') && (
                    <span className="flex items-center gap-1.5 text-amber-400 bg-amber-500/20 px-2.5 py-1.5 rounded-lg text-xs font-semibold">
                      <AlertTriangle className="w-4 h-4" />
                      סנטימנט קיצוני
                    </span>
                  )}
                </div>
                <div
                  className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold ${
                    latestPrediction.predicted_direction === 'Bullish'
                      ? 'bg-emerald-500/30 text-emerald-300'
                      : latestPrediction.predicted_direction === 'Bearish'
                        ? 'bg-red-500/30 text-red-300'
                        : 'bg-slate-600 text-slate-300'
                  }`}
                >
                  {latestPrediction.predicted_direction === 'Bullish' && <TrendingUp className="w-5 h-5" />}
                  {latestPrediction.predicted_direction === 'Bearish' && <TrendingDown className="w-5 h-5" />}
                  {latestPrediction.predicted_direction === 'Neutral' && <Minus className="w-5 h-5" />}
                  {DIRECTION_HE[latestPrediction.predicted_direction] ?? latestPrediction.predicted_direction}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-slate-700 border-b border-slate-700">
                <div className="p-4 sm:p-6">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">הסתברות</div>
                  <div className="text-xl sm:text-2xl font-semibold text-slate-100">{latestPrediction.probability != null ? `${latestPrediction.probability}%` : '—'}</div>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">תנועה צפויה</div>
                  <div className="text-xl sm:text-2xl font-semibold text-slate-100">
                    {(latestPrediction.target_percentage ?? 0) > 0 ? '+' : ''}
                    {latestPrediction.target_percentage ?? 0}%
                  </div>
                </div>
                <div className="p-4 sm:p-6 col-span-2 sm:col-span-1">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">מחיר כניסה</div>
                  <div className="text-xl sm:text-2xl font-semibold text-slate-100">
                    ${(latestPrediction.entry_price ?? 0).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-700 border-b border-slate-700">
                <div className="p-3 sm:p-4">
                  <div className="text-[10px] text-slate-500 uppercase mb-1">מודל</div>
                  <div className="text-sm font-semibold text-slate-200">{latestPrediction.model_name || '—'}</div>
                </div>
                <div className="p-3 sm:p-4">
                  <div className="text-[10px] text-slate-500 uppercase mb-1">זמן תגובה</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {latestPrediction.latency_ms ? `${latestPrediction.latency_ms} ms` : '—'}
                  </div>
                </div>
                <div className="p-3 sm:p-4">
                  <div className="text-[10px] text-slate-500 uppercase mb-1">תיקון</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {latestPrediction.validation_repaired ? 'כן' : 'לא'}
                  </div>
                </div>
                <div className="p-3 sm:p-4">
                  <div className="text-[10px] text-slate-500 uppercase mb-1">סנטימנט</div>
                  <div className="text-sm font-semibold text-slate-200">
                    {typeof latestPrediction.sentiment_score === 'number'
                      ? latestPrediction.sentiment_score >= 0
                        ? `+${latestPrediction.sentiment_score.toFixed(2)}`
                        : latestPrediction.sentiment_score.toFixed(2)
                      : '—'}
                  </div>
                </div>
              </div>

              {chartData.length > 0 && (
                <div className="p-4 sm:p-6 border-b border-slate-700">
                  <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-4">
                    היסטוריית מחירים + ביצועי סימולציה
                  </h3>
                  <div className="h-48 sm:h-64 w-full min-h-[200px]">
                    <PriceHistoryChart data={chartData} executionMarkers={executionMarkers} />
                  </div>
                </div>
              )}

              {(latestPrediction.bottom_line_he || latestPrediction.risk_level_he || latestPrediction.forecast_24h_he) && (
                <div className="p-4 sm:p-6 border-b border-slate-700 bg-slate-800/40">
                  <h3 className="text-xs font-semibold text-amber-400/90 uppercase tracking-wider mb-2">דוח עברית</h3>
                  {latestPrediction.bottom_line_he && (
                    <p className="text-slate-200 text-sm font-medium mb-1" dir="rtl">{latestPrediction.bottom_line_he}</p>
                  )}
                  {latestPrediction.risk_level_he && (
                    <p
                      className={`text-xs mb-1 ${String(latestPrediction.risk_level_he).includes('גבוה') ? 'text-red-400' : String(latestPrediction.risk_level_he).includes('נמוך') ? 'text-emerald-400' : 'text-amber-400/90'}`}
                      dir="rtl"
                    >
                      {latestPrediction.risk_level_he}
                    </p>
                  )}
                  {latestPrediction.forecast_24h_he && (
                    <p className="text-slate-400 text-xs" dir="rtl">{latestPrediction.forecast_24h_he}</p>
                  )}
                </div>
              )}
              <div className="p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-5 h-5 text-amber-400" />
                  <h3 className="text-sm font-semibold text-slate-100">לוגיקת AI</h3>
                </div>
                <p className="text-slate-300 text-sm leading-relaxed" dir="rtl">
                  {latestPrediction.logic ?? 'לא זמין'}
                </p>
                {(latestPrediction.strategic_advice?.trim?.() ?? '') && (
                  <div className="mt-5 pt-5 border-t border-slate-700">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">המלצה אסטרטגית</h4>
                    <p className="text-slate-300 text-sm leading-relaxed" dir="rtl">
                      {latestPrediction.strategic_advice ?? 'לא זמין'}
                    </p>
                  </div>
                )}
                {(latestPrediction.learning_context?.trim?.() ?? '') && (
                  <div className="mt-5 pt-5 border-t border-slate-700">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">הקשר למידה</h4>
                    <p className="text-slate-300 text-sm leading-relaxed" dir="rtl">
                      {latestPrediction.learning_context ?? 'לא זמין'}
                    </p>
                  </div>
                )}
                {((latestPrediction.sources?.length ?? 0) > 0) && (
                  <div className="mt-5 pt-5 border-t border-slate-700">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase mb-2">מקורות</h4>
                    <div className="space-y-2">
                      {(latestPrediction.sources ?? []).map((source, idx) => (
                        <div
                          key={`${source?.source_name ?? idx}-${idx}`}
                          className="rounded-lg border border-slate-600 bg-slate-700/50 p-2"
                        >
                          <div className="text-xs font-semibold text-slate-200">{source?.source_name ?? 'לא זמין'}</div>
                          <div className="text-[11px] text-slate-400">
                            {source?.source_type ?? '—'} • ציון {Number(source?.relevance_score ?? 0).toFixed(2)}
                          </div>
                          <div className="text-[11px] text-slate-500">{source?.evidence_snippet ?? 'לא זמין'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Simulation trades for this symbol */}
            {simulationTrades.length > 0 && (
              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-4 sm:p-6">
                <h3 className="text-base font-semibold text-slate-100 mb-3 flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-amber-400" />
                  היסטוריית סימולציה — {symbol}
                </h3>
                <ul className="space-y-2 max-h-48 overflow-auto">
                  {simulationTrades.slice(0, 20).map((tr) => (
                    <li
                      key={tr.id}
                      className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-slate-700/50 border border-slate-600 text-sm"
                    >
                      <span
                        className={
                          tr.side === 'buy' ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'
                        }
                      >
                        {tr.side === 'buy' ? 'קנייה' : 'מכירה'}
                      </span>
                      <span className="text-slate-300">
                        ${tr.amountUsd.toFixed(0)} @ ${tr.price.toLocaleString()}
                      </span>
                      <span className="text-slate-500 text-xs">{tr.dateLabel}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-3">
                <div className="text-[10px] uppercase text-slate-500">תוקן</div>
                <div className="text-xl font-semibold text-slate-100">{repairedCount}</div>
              </div>
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-3">
                <div className="text-[10px] uppercase text-slate-500">גיבוי</div>
                <div className="text-xl font-semibold text-slate-100">{fallbackCount}</div>
              </div>
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-3">
                <div className="text-[10px] uppercase text-slate-500">עם מקורות</div>
                <div className="text-xl font-semibold text-slate-100">{withSourcesCount}</div>
              </div>
              <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-3">
                <div className="text-[10px] uppercase text-slate-500">זמן ממוצע</div>
                <div className="text-xl font-semibold text-slate-100">
                  {Number.isFinite(avgLatency) ? `${Math.round(avgLatency)} ms` : '—'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-[280px] flex flex-col items-center justify-center text-center p-6 sm:p-8 bg-slate-800/50 rounded-2xl border border-slate-700 border-dashed">
            <div className="w-16 h-16 bg-slate-700 rounded-2xl flex items-center justify-center mb-4">
              <BarChart2 className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-200 mb-2">אין עדיין תחזיות</h3>
            <p className="text-sm text-slate-500 max-w-sm">
              בחר נכס (BTC, ETH, SOL) ולחץ על הרץ ניתוח כדי להתחיל.
            </p>
          </div>
        )}

        {/* Prediction history */}
        {history.length > 0 && (
          <div className="space-y-4 pt-4">
            <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Database className="w-5 h-5 text-slate-400" />
              {t.history}
            </h3>
            <div
              className="space-y-3 max-h-[500px] overflow-auto min-w-0"
              onScroll={(e) => setHistoryScrollTop(e.currentTarget.scrollTop)}
            >
              {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
              {windowedRows.map((record) => (
                <div
                  key={record.id}
                  className="bg-slate-800/80 border border-slate-700 rounded-xl p-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-100">{record.symbol}</span>
                      <span className="text-xs text-slate-500">
                        {new Date(record.prediction_date).toLocaleString('he-IL')}
                      </span>
                      {(record.risk_status === 'extreme_fear' || record.risk_status === 'extreme_greed') && (
                        <span className="flex items-center gap-1 text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-md text-[10px] font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          קיצוני
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-md ${
                          record.predicted_direction === 'Bullish'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : record.predicted_direction === 'Bearish'
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-slate-600 text-slate-300'
                        }`}
                      >
                        {(DIRECTION_HE[record.predicted_direction] ?? record.predicted_direction)} ({record.probability}%)
                      </span>
                      {typeof record.sentiment_score === 'number' && (
                        <span className="text-xs px-2 py-1 rounded-md bg-slate-600 text-slate-300">
                          סנטימנט: {record.sentiment_score >= 0 ? '+' : ''}
                          {record.sentiment_score.toFixed(2)}
                        </span>
                      )}
                      {record.status === 'pending' ? (
                        <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/20 px-2 py-1 rounded-md">
                          <Clock className="w-3 h-3" /> ממתין
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded-md">
                          <CheckCircle2 className="w-3 h-3" /> אומת
                        </span>
                      )}
                    </div>
                  </div>
                  {record.status === 'evaluated' && record.error_report && (
                    <div className="mt-3 pt-3 border-t border-slate-700">
                      <div className="text-xs text-slate-500 mb-1">תוצאה: {record.actual_outcome}</div>
                      <div className="bg-slate-700/50 rounded-lg p-3 text-sm text-slate-300" dir="rtl">
                        <span className="font-semibold text-slate-200 ml-1">מסקנת למידה:</span>
                        {record.error_report}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
            </div>
            {history.length > visibleHistoryCount && (
              <button
                type="button"
                onClick={() => setVisibleHistoryCount((p) => p + 10)}
                className="w-full min-h-[44px] mt-2 py-2.5 px-4 bg-slate-700 border border-slate-600 hover:bg-slate-600 text-slate-200 rounded-xl font-medium text-sm transition-colors touch-manipulation"
              >
                {t.loadMore}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
