'use client';

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import dynamic from 'next/dynamic';
import { TrendingUp, TrendingDown, Minus, Activity, AlertTriangle, Lightbulb, BarChart2, Zap, Loader2, RefreshCw, Database, CheckCircle2, Clock } from 'lucide-react';
import { analyzeCrypto, getHistory, evaluatePendingPredictions } from '@/app/actions';
import type { PredictionRecord } from '@/lib/db';
import { useLocale } from '@/hooks/use-locale';

const PriceHistoryChart = dynamic(() => import('@/components/PriceHistoryChart'));

export default function CryptoAnalyzer() {
  const { t } = useLocale();
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PredictionRecord[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
  const [historyScrollTop, setHistoryScrollTop] = useState(0);
  const [formRenderedAt, setFormRenderedAt] = useState<number>(Date.now());
  const [honeypot, setHoneypot] = useState('');

  const loadHistory = async () => {
    const data = await getHistory();
    setHistory(data);
  };

  useEffect(() => {
    loadHistory().catch(() => {
      setError('Failed to load prediction history.');
    });
  }, []);

  useEffect(() => {
    setFormRenderedAt(Date.now());
  }, [symbol]);

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
  }, [loading, evaluating, symbol]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setChartData([]);

    const res = await analyzeCrypto({
      symbol,
      honeypot,
      submittedAt: formRenderedAt,
      captchaToken: '',
    });
    if (res.success) {
      if (res.chartData) setChartData(res.chartData);
      await loadHistory();
    } else {
      setError(res.error || 'An error occurred during analysis.');
    }
    setLoading(false);
  };

  const handleEvaluate = async () => {
    setEvaluating(true);
    const res = await evaluatePendingPredictions();
    if (res.success) {
      await loadHistory();
    }
    setEvaluating(false);
  };

  const latestPrediction = history.length > 0 ? history[0] : null;
  const visibleHistory = history.slice(0, visibleHistoryCount);
  const repairedCount = history.filter((record) => record.validation_repaired).length;
  const fallbackCount = history.filter((record) => record.fallback_used).length;
  const withSourcesCount = history.filter((record) => (record.sources?.length || 0) > 0).length;
  const latencyRows = history.filter((record) => typeof record.latency_ms === 'number');
  const avgLatency = latencyRows.reduce((acc, record) => acc + (record.latency_ms || 0), 0) / Math.max(1, latencyRows.length);

  const rowHeight = 132;
  const viewportHeight = 500;
  const overscan = 4;
  const totalRows = visibleHistory.length;
  const startIndex = Math.max(0, Math.floor(historyScrollTop / rowHeight) - overscan);
  const endIndex = Math.min(totalRows, Math.ceil((historyScrollTop + viewportHeight) / rowHeight) + overscan);
  const windowedRows = visibleHistory.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = Math.max(0, (totalRows - endIndex) * rowHeight);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Input Section */}
      <div className="lg:col-span-4 space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <Activity className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">{t.newAnalysis}</h2>
          </div>

          <form onSubmit={handleAnalyze} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t.assetSymbol}</label>
              <input 
                type="text" 
                value={symbol} 
                onChange={e => setSymbol(e.target.value)} 
                placeholder="e.g. BTCUSDT"
                aria-label="Asset symbol"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-base font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/50 uppercase" 
                required 
              />
              <input
                type="text"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                className="hidden"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />
              <p className="mt-2 text-xs text-slate-500">
                The system will automatically fetch OHLCV data from Binance and the Fear & Greed index.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              aria-label="Run quantitative analysis"
              className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t.analyzing}
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  {t.runAnalysis}
                </>
              )}
            </button>
            <p className="text-[11px] text-slate-500">{t.keyboardHint}</p>
          </form>
        </div>

        {/* Evaluation Control */}
        <div className="bg-indigo-50/50 rounded-2xl border border-indigo-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
              <RefreshCw className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">{t.feedbackLoop}</h2>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            Verify pending predictions against current market prices to generate learning reports.
          </p>
          <button
            onClick={handleEvaluate}
            disabled={evaluating}
            aria-label="Evaluate past predictions"
            className="w-full py-2.5 px-4 bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-700 rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-sm"
          >
            {evaluating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t.evaluating}
              </>
            ) : (
              <>
                <Database className="w-4 h-4" />
                {t.evaluate}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Output & History Section */}
      <div className="lg:col-span-8 space-y-6">
        {error && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3" role="status" aria-live="polite">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">{error}</div>
          </motion.div>
        )}

        {latestPrediction ? (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-slate-400" />
              {t.latestPrediction}
            </h3>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              {/* Header */}
              <div className={`p-6 border-b border-slate-100 flex items-center justify-between ${
                latestPrediction.predicted_direction === 'Bullish' ? 'bg-emerald-50/50' : 
                latestPrediction.predicted_direction === 'Bearish' ? 'bg-red-50/50' : 'bg-slate-50/50'
              }`}>
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-500 mb-1">Analysis Result for</div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900">{latestPrediction.symbol}</h2>
                  </div>
                  {(latestPrediction.risk_status === 'extreme_fear' || latestPrediction.risk_status === 'extreme_greed') && (
                    <span className="flex items-center gap-1.5 text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded-lg animate-pulse" title="Prediction made under extreme market sentiment – 50% confidence penalty applied">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <span className="text-xs font-semibold">Extreme Sentiment</span>
                    </span>
                  )}
                </div>
                <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold ${
                  latestPrediction.predicted_direction === 'Bullish' ? 'bg-emerald-100 text-emerald-700' : 
                  latestPrediction.predicted_direction === 'Bearish' ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-700'
                }`}>
                  {latestPrediction.predicted_direction === 'Bullish' && <TrendingUp className="w-5 h-5" />}
                  {latestPrediction.predicted_direction === 'Bearish' && <TrendingDown className="w-5 h-5" />}
                  {latestPrediction.predicted_direction === 'Neutral' && <Minus className="w-5 h-5" />}
                  {latestPrediction.predicted_direction}
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
                <div className="p-6">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Probability</div>
                  <div className="text-2xl font-semibold text-slate-900">{latestPrediction.probability}%</div>
                </div>
                <div className="p-6">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Expected Move</div>
                  <div className="text-2xl font-semibold text-slate-900">{latestPrediction.target_percentage > 0 ? '+' : ''}{latestPrediction.target_percentage}%</div>
                </div>
                <div className="p-6">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Entry Price</div>
                  <div className="text-2xl font-semibold text-slate-900">${latestPrediction.entry_price.toLocaleString()}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
                <div className="p-4">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Model</div>
                  <div className="text-sm font-semibold text-slate-900">{latestPrediction.model_name || 'n/a'}</div>
                </div>
                <div className="p-4">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Latency</div>
                  <div className="text-sm font-semibold text-slate-900">{latestPrediction.latency_ms ? `${latestPrediction.latency_ms} ms` : 'n/a'}</div>
                </div>
                <div className="p-4">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Repair</div>
                  <div className="text-sm font-semibold text-slate-900">{latestPrediction.validation_repaired ? 'Applied' : 'No'}</div>
                </div>
                <div className="p-4">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">Sentiment Score</div>
                  <div className="text-sm font-semibold text-slate-900">
                    {typeof latestPrediction.sentiment_score === 'number'
                      ? latestPrediction.sentiment_score >= 0
                        ? `+${latestPrediction.sentiment_score.toFixed(2)}`
                        : latestPrediction.sentiment_score.toFixed(2)
                      : 'n/a'}
                  </div>
                  {latestPrediction.market_narrative && (
                    <p className="text-[10px] text-slate-500 mt-1 line-clamp-2" title={latestPrediction.market_narrative}>
                      {latestPrediction.market_narrative}
                    </p>
                  )}
                </div>
              </div>

              {/* Chart */}
              {chartData.length > 0 && (
                <div className="p-6 border-b border-slate-100">
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-4">30-Day Price History</h3>
                  <div className="h-48 w-full">
                    <PriceHistoryChart data={chartData} />
                  </div>
                </div>
              )}

              {/* Details */}
              <div className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-5 h-5 text-amber-500" />
                  <h3 className="text-sm font-semibold text-slate-900">AI Logic (Hebrew)</h3>
                </div>
                <p className="text-slate-600 text-sm leading-relaxed" dir="rtl">{latestPrediction.logic}</p>

                {latestPrediction.strategic_advice && (
                  <div className="mt-5 pt-5 border-t border-slate-100">
                    <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Strategic Advice</h4>
                    <p className="text-slate-600 text-sm leading-relaxed" dir="rtl">{latestPrediction.strategic_advice}</p>
                  </div>
                )}

                {latestPrediction.learning_context && (
                  <div className="mt-5 pt-5 border-t border-slate-100">
                    <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Learning Context</h4>
                    <p className="text-slate-600 text-sm leading-relaxed" dir="rtl">{latestPrediction.learning_context}</p>
                  </div>
                )}

                {latestPrediction.sources && latestPrediction.sources.length > 0 && (
                  <div className="mt-5 pt-5 border-t border-slate-100">
                    <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">Sources</h4>
                    <div className="space-y-2">
                      {latestPrediction.sources.map((source, idx) => (
                        <div key={`${source.source_name}-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <div className="text-xs font-semibold text-slate-800">{source.source_name}</div>
                          <div className="text-[11px] text-slate-600">{source.source_type} • score {source.relevance_score.toFixed(2)}</div>
                          <div className="text-[11px] text-slate-500">{source.evidence_snippet}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Repaired</div>
                <div className="text-xl font-semibold text-slate-900">{repairedCount}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Fallback Used</div>
                <div className="text-xl font-semibold text-slate-900">{fallbackCount}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">With Sources</div>
                <div className="text-xl font-semibold text-slate-900">{withSourcesCount}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Avg Latency</div>
                <div className="text-xl font-semibold text-slate-900">{Number.isFinite(avgLatency) ? `${Math.round(avgLatency)} ms` : 'n/a'}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center p-8 bg-slate-50/50 rounded-2xl border border-slate-200 border-dashed">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-slate-200 flex items-center justify-center mb-4">
              <BarChart2 className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Predictions Yet</h3>
            <p className="text-sm text-slate-500 max-w-sm">
              Enter a symbol on the left to run your first quantitative analysis.
            </p>
          </div>
        )}

        {/* History List */}
        {history.length > 0 && (
          <div className="space-y-4 pt-6">
            <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Database className="w-5 h-5 text-slate-400" />
              {t.history}
            </h3>
            <div className="space-y-3 max-h-[500px] overflow-auto" onScroll={(event) => setHistoryScrollTop(event.currentTarget.scrollTop)}>
              {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
              {windowedRows.map((record) => (
                <div key={record.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-slate-900">{record.symbol}</span>
                      <span className="text-xs text-slate-500">{new Date(record.prediction_date).toLocaleString()}</span>
                      {(record.risk_status === 'extreme_fear' || record.risk_status === 'extreme_greed') && (
                        <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md animate-pulse" title="Prediction made under extreme market sentiment">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-medium">Extreme</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-md ${
                        record.predicted_direction === 'Bullish' ? 'bg-emerald-50 text-emerald-700' : 
                        record.predicted_direction === 'Bearish' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {record.predicted_direction} ({record.probability}%)
                      </span>
                      {typeof record.sentiment_score === 'number' && (
                        <span className="text-xs font-medium px-2 py-1 rounded-md bg-slate-100 text-slate-700" title={record.market_narrative ?? undefined}>
                          Sentiment: {record.sentiment_score >= 0 ? '+' : ''}{record.sentiment_score.toFixed(2)}
                        </span>
                      )}
                      {record.status === 'pending' ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-md">
                          <Clock className="w-3 h-3" /> Pending
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">
                          <CheckCircle2 className="w-3 h-3" /> Evaluated
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {record.status === 'evaluated' && record.error_report && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <div className="text-xs text-slate-500 mb-1">Outcome: {record.actual_outcome}</div>
                      <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700" dir="rtl">
                        <span className="font-semibold text-slate-900 ml-1">מסקנת למידה:</span>
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
                onClick={() => setVisibleHistoryCount((prev) => prev + 10)}
                className="w-full mt-2 py-2.5 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-medium text-sm transition-colors"
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
