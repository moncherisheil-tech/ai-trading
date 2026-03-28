'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
  Brain,
  CheckCircle2,
  Clock,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  Target,
  Globe,
} from 'lucide-react';
import {
  analyzeCrypto,
  getHistory,
  evaluatePendingPredictions,
  getGemsTicker24hAction,
  getAppSettingsForViewerAction,
} from '@/app/actions';
import type { PredictionRecord } from '@/lib/db';
import { useLocale } from '@/hooks/use-locale';
import { useSimulation, INITIAL_WALLET_USD } from '@/context/SimulationContext';
import { useToast } from '@/context/ToastContext';
import { toSymbol } from '@/lib/symbols';
import type { Ticker24hElite } from '@/lib/gem-finder';
import SymbolSelect from '@/components/SymbolSelect';

const PriceHistoryChart = dynamic(() => import('@/components/PriceHistoryChart'));

const TradingChart = dynamic(() => import('@/components/TradingChart'), { ssr: false });

const DIRECTION_HE: Record<string, string> = {
  Bullish: 'שורי',
  Bearish: 'דובי',
  Neutral: 'ניטרלי',
};

export default function CryptoAnalyzer() {
  const { t, locale } = useLocale();
  const toast = useToast();
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
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PredictionRecord[]>([]);
  const [chartData, setChartData] = useState<{ date: string; close: number; open?: number; high?: number; low?: number }[]>([]);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(10);
  const [historyScrollTop, setHistoryScrollTop] = useState(0);
  const [formRenderedAt, setFormRenderedAt] = useState<number>(Date.now());
  const [honeypot, setHoneypot] = useState('');
  const [simAmountUsd, setSimAmountUsd] = useState('');
  const [simError, setSimError] = useState<string | null>(null);
  const [gemBaseSymbols, setGemBaseSymbols] = useState<string[] | null>(null);
  const [eliteSymbolSet, setEliteSymbolSet] = useState<Set<string> | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [livePriceConnected, setLivePriceConnected] = useState(false);
  const [manualSymbolInput, setManualSymbolInput] = useState('');
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [fetchedPriceForSymbol, setFetchedPriceForSymbol] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await getGemsTicker24hAction();
        if (cancelled || !Array.isArray(data)) return;
        const bases = data.map((t) => String(t.symbol || '').replace('USDT', '')).filter(Boolean);
        setGemBaseSymbols(bases.length > 0 ? bases : null);
      } catch {
        // ignore
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await getGemsTicker24hAction({ elite: true });
        if (cancelled || !Array.isArray(data)) return;
        const set = new Set<string>();
        (data as Ticker24hElite[]).forEach((t) => {
          if (t.isElite && t.symbol) set.add(String(t.symbol));
        });
        setEliteSymbolSet(set.size > 0 ? set : null);
      } catch {
        // ignore
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // Pre-fill simulation amount from AppSettings (Default Position Size USD)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await getAppSettingsForViewerAction();
        if (cancelled || !s?.risk?.defaultPositionSizeUsd) return;
        setSimAmountUsd((prev) => (prev === '' ? String(s.risk!.defaultPositionSizeUsd) : prev));
      } catch {
        // ignore
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const loadHistory = useCallback(async () => {
    const data = await getHistory();
    setHistory(data);
  }, []);

  useEffect(() => {
    loadHistory().catch(() => {
      setError(t.loadHistoryError);
    });
  }, [loadHistory, t.loadHistoryError]);

  useEffect(() => {
    setFormRenderedAt(Date.now());
  }, [selectedSymbol]);

  // Binance WebSocket: real-time ticker price (field "c" = last price). Cleanup on unmount; avoid rapid overlapping reconnects.
  useEffect(() => {
    const stream = `${symbol.toLowerCase()}@ticker`;
    const wsUrl = `wss://stream.binance.com:9443/ws/${stream}`;
    setLivePrice(null);
    setLivePriceConnected(false);
    let ws: WebSocket | null = null;
    let mounted = true;
    const RECONNECT_COOLDOWN_MS = 2000;
    let lastConnectAt = 0;

    const connect = () => {
      if (!mounted) return;
      const now = Date.now();
      if (now - lastConnectAt < RECONNECT_COOLDOWN_MS) return;
      lastConnectAt = now;
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          if (!mounted) return;
          try {
            const data = JSON.parse(event.data) as { c?: string };
            const c = data.c;
            if (typeof c === 'string') {
              const p = parseFloat(c);
              if (Number.isFinite(p) && p > 0) setLivePrice(p);
            }
          } catch {
            // ignore parse errors
          }
        };
        ws.onopen = () => mounted && setLivePriceConnected(true);
        ws.onerror = () => mounted && setLivePriceConnected(false);
        ws.onclose = () => mounted && setLivePriceConnected(false);
      } catch {
        setLivePriceConnected(false);
      }
    };

    connect();

    return () => {
      mounted = false;
      const sock = ws;
      ws = null;
      if (sock != null) {
        sock.onopen = null;
        sock.onmessage = null;
        sock.onerror = null;
        sock.onclose = null;
        if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) {
          sock.close();
        }
      }
      setLivePrice(null);
      setLivePriceConnected(false);
    };
  }, [symbol]);

  /** Fetch live price for a manually entered symbol (e.g. SOL, ETH) before opening a trade. Sanitized against injection. */
  const fetchLivePriceForSymbol = async (baseSymbol: string) => {
    const raw = (baseSymbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    if (!raw) return;
    const sym = raw.endsWith('USDT') ? raw : `${raw}USDT`;
    setFetchingPrice(true);
    setFetchedPriceForSymbol(null);
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(sym)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error('Price fetch failed');
      const data = (await res.json()) as { symbol?: string; price?: string };
      const p = data?.price ? parseFloat(data.price) : NaN;
      if (Number.isFinite(p) && p > 0) {
        setLivePrice(p);
        setFetchedPriceForSymbol(sym);
        setSelectedSymbol(raw.replace('USDT', ''));
        toast.success(`מחיר ${sym}: $${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);
      } else {
        toast.error('לא התקבל מחיר תקף עבור הסמל.');
      }
    } catch {
      toast.error('שגיאה בשליפת מחיר. בדוק חיבור לרשת.');
    } finally {
      setFetchingPrice(false);
    }
  };

  const handleAnalyze = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const waitingForSocket = livePrice == null && !livePriceConnected;
    setLoadingMessage(waitingForSocket ? 'Scanning... מתחבר למחיר חי מהשוק' : 'ממתין לנתוני שוק חיים · סנכרון טלמטריה מתקדם...');
    setError(null);
    setSimError(null);
    setChartData([]);
    try {
      const symbolForAnalysis = (fetchedPriceForSymbol || symbol).toUpperCase();
      const res = await analyzeCrypto({
        symbol: symbolForAnalysis,
        price: Number.isFinite(livePrice) && livePrice != null ? livePrice : undefined,
        honeypot,
        submittedAt: formRenderedAt,
        captchaToken: '',
        locale,
      });
      if (res.success) {
        const chartData = 'chartData' in res ? res.chartData : undefined;
        if (chartData?.length) {
          setChartData(
            chartData.map((d: { date: string; close: number; open?: number; high?: number; low?: number }) => ({
              date: d.date,
              close: d.close,
              open: d.open,
              high: d.high,
              low: d.low,
            }))
          );
        }
        await loadHistory();
      } else {
        const message = res.error === 'Unauthorized request.' ? t.unauthorizedRequest : (res.error || t.analysisErrorDefault);
        setError(message);
        setChartData([]);
      }
    } catch {
      setError(waitingForSocket ? 'Scanning... החיבור למחיר חי עדיין בהקמה, נסו שוב בעוד רגע.' : t.analysisErrorDefault);
      setChartData([]);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  }, [fetchedPriceForSymbol, formRenderedAt, honeypot, livePrice, livePriceConnected, loadHistory, symbol, locale, t.analysisErrorDefault, t.unauthorizedRequest]);

  const handleEvaluate = useCallback(async () => {
    setEvaluating(true);
    const res = await evaluatePendingPredictions({ locale });
    if (res.success) await loadHistory();
    setEvaluating(false);
  }, [loadHistory]);

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
  }, [loading, evaluating, handleAnalyze, handleEvaluate]);

  const latestPrediction = history.length > 0 ? history[0] : null;
  const entryPrice = latestPrediction?.entry_price ?? 0;
  const displayPrice = livePrice ?? entryPrice;
  const visibleHistory = history.slice(0, visibleHistoryCount);
  const repairedCount = history.filter((r) => r.validation_repaired).length;
  const fallbackCount = history.filter((r) => r.fallback_used).length;
  const withSourcesCount = history.filter((r) => (r.sources?.length ?? 0) > 0).length;
  const latencyRows = history.filter((r) => typeof r.latency_ms === 'number');
  const avgLatency =
    latencyRows.reduce((acc, r) => acc + (r.latency_ms || 0), 0) / Math.max(1, latencyRows.length);

  const executionMarkers = useMemo(() => getMarkersForSymbol(symbol), [getMarkersForSymbol, symbol]);
  const simulationTrades = useMemo(() => getTradesForSymbol(symbol), [getTradesForSymbol, symbol]);

  const tradingChartProps = useMemo(() => {
    const data =
      chartData.length > 0
        ? chartData.map((d) => ({
            time: d.date,
            open: d.open ?? d.close,
            high: d.high ?? d.close,
            low: d.low ?? d.close,
            close: d.close,
          }))
        : [];
    const entry_zone =
      latestPrediction?.entry_price != null && latestPrediction.entry_price > 0
        ? latestPrediction.entry_price
        : undefined;
    const take_profit_targets =
      latestPrediction?.suggested_tp != null ? [latestPrediction.suggested_tp] : [];
    const stop_loss_level = latestPrediction?.suggested_sl ?? undefined;
    return { data, entry_zone, take_profit_targets, stop_loss_level };
  }, [chartData, latestPrediction?.entry_price, latestPrediction?.suggested_tp, latestPrediction?.suggested_sl]);

  const handleSimBuy = async () => {
    const amount = parseFloat(simAmountUsd);
    if (!Number.isFinite(amount) || amount <= 0 || displayPrice <= 0) {
      setSimError('סכום או מחיר לא תקינים.');
      return;
    }
    const result = await addTrade(symbol, 'buy', displayPrice, amount);
    if (!result.success) {
      const msg =
        result.message ??
        (result.error === 'INSUFFICIENT_FUNDS'
          ? 'אין מספיק יתרה בארנק הסימולציה לביצוע פעולה זו.'
          : result.error === 'INSUFFICIENT_ASSET'
            ? 'אין מספיק נכס זמין למכירה עבור סימולציה זו.'
            : result.error === 'PERSISTENCE_FAILED'
              ? 'העסקה בוצעה אך שמירה למסד הנתונים נכשלה.'
              : 'הפעולה נכשלה. בדוק את הנתונים ונסה שוב.');
      setSimError(msg);
      toast.error(msg);
      return;
    }
    setSimError(null);
    setSimAmountUsd('');
    toast.success('העסקה בוצעה בהצלחה.');
  };

  const handleSimSell = async () => {
    const amount = parseFloat(simAmountUsd);
    if (!Number.isFinite(amount) || amount <= 0 || displayPrice <= 0) {
      setSimError('סכום או מחיר לא תקינים.');
      return;
    }
    const result = await addTrade(symbol, 'sell', displayPrice, amount);
    if (!result.success) {
      const msg =
        result.message ??
        (result.error === 'INSUFFICIENT_FUNDS'
          ? 'אין מספיק יתרה בארנק הסימולציה לביצוע פעולה זו.'
          : result.error === 'INSUFFICIENT_ASSET'
            ? 'אין מספיק נכס זמין למכירה עבור סימולציה זו.'
            : result.error === 'PERSISTENCE_FAILED'
              ? 'העסקה בוצעה אך שמירה למסד הנתונים נכשלה.'
              : 'הפעולה נכשלה. בדוק את הנתונים ונסה שוב.');
      setSimError(msg);
      toast.error(msg);
      return;
    }
    setSimError(null);
    setSimAmountUsd('');
    toast.success('העסקה בוצעה בהצלחה.');
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
      className="w-full min-w-0 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-x-hidden"
      dir="rtl"
    >
      {/* Currency switcher + Input */}
      <div className="lg:col-span-4 space-y-4 md:space-y-5 relative z-[2]">
        {/* Multi-currency switcher */}
        <div className="ui-panel-dense ui-card frosted-obsidian min-w-0 min-h-[260px] backdrop-blur-[60px]">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-500 shrink-0">
              <Activity className="w-5 h-5" />
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white">{t.newAnalysis}</h2>
          </div>
          <p className="text-sm text-zinc-500 mb-3">בחר או חפש מטבע (BTC, ETH, SOL ועוד)</p>
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
              className="btn-terminal-primary w-full min-h-[48px] py-3 px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0 touch-manipulation active:scale-[0.985]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                  {t.analyzing}
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  {t.runAnalysis} ({symbol})
                </>
              )}
            </button>
            {loading && loadingMessage && (
              <p className="text-sm text-amber-400/90 text-center min-h-[1.25rem]" dir="rtl" role="status" aria-live="polite">
                {loadingMessage}
              </p>
            )}
            <p className="text-xs text-zinc-500">{t.keyboardHint}</p>
          </form>
        </div>

        {/* Simulation wallet & quick trade — Deep Sea Trading Station theme */}
        <div className="ui-panel-dense ui-card frosted-obsidian rounded-2xl min-w-0 min-h-[230px] bg-gradient-to-b from-[#0a1628] to-[#06101a] border-cyan-500/24 shadow-[0_0_24px_rgba(34,211,238,0.08)] backdrop-blur-[60px]">
          <div className="flex items-center justify-between mb-4 gap-2 min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-cyan-500/15 border border-cyan-400/30 rounded-lg text-cyan-400 shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-cyan-50 truncate">תחנת מסחר — ארנק סימולציה</h2>
            </div>
            <button
              type="button"
              onClick={resetSimulation}
              aria-label="איפוס ארנק סימולציה להתחלה חדשה"
              className="btn-terminal-secondary text-xs flex items-center gap-1 touch-manipulation min-h-[40px] px-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
              title="איפוס לסימולציה חדשה"
            >
              <RotateCcw className="w-4 h-4" />
              איפוס
            </button>
          </div>
          <div className="text-2xl font-bold text-cyan-50 tabular-nums live-data-number mb-1" suppressHydrationWarning>
            ${walletUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-500 mb-4" suppressHydrationWarning>יתרה התחלתית: <span className="live-data-number">${INITIAL_WALLET_USD.toLocaleString()}</span></p>

          {/* Manual symbol + fetch live price */}
          <div className="mb-4 space-y-2">
            <label htmlFor="simulated-wallet-manual-symbol" className="text-xs font-medium text-slate-400 block">הזן סמל ושלוף מחיר לפני פתיחת עסקה</label>
            <div className="flex gap-2 flex-wrap">
              <input
                id="simulated-wallet-manual-symbol"
                name="manualSymbol"
                type="text"
                value={manualSymbolInput}
                onChange={(e) => setManualSymbolInput(e.target.value.toUpperCase())}
                placeholder="לדוגמה: SOL, ETH"
                className="flex-1 min-w-[100px] min-h-[44px] px-3 py-2 rounded-xl bg-[#0c1220] border border-cyan-500/20 text-cyan-50 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-400/40 transition-all"
                aria-label="סמל מטבע להזנה ידנית"
                dir="ltr"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => fetchLivePriceForSymbol(manualSymbolInput)}
                disabled={fetchingPrice || !manualSymbolInput.trim()}
                className="btn-terminal-accent min-h-[44px] px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 disabled:opacity-50 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
              >
                {fetchingPrice ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                שלוף מחיר
              </button>
            </div>
          </div>

          {displayPrice > 0 && (
            <>
              <p className="text-sm text-slate-400 mb-2 flex items-center gap-2 flex-wrap" suppressHydrationWarning>
                <span>מחיר נוכחי: <span dir="ltr" className="live-data-number">${displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span></span>
                {livePriceConnected && (
                  <span className="inline-flex items-center gap-1.5 text-cyan-400" title="מחיר חי — Binance">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" />
                    </span>
                    <span className="text-xs font-medium">חי</span>
                  </span>
                )}
              </p>
              <div className="flex gap-2 flex-wrap items-center">
                <label htmlFor="simulated-wallet-amount-usd" className="sr-only">סכום לרכישה או מכירה ב-USD</label>
                <input
                  id="simulated-wallet-amount-usd"
                  name="simAmountUsd"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="סכום ב-USD"
                  value={simAmountUsd}
                  onChange={(e) => setSimAmountUsd(e.target.value)}
                  className="flex-1 min-w-0 min-h-[44px] px-3 py-2 rounded-xl bg-[#0c1220] border border-cyan-500/20 text-cyan-50 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-400/40 transition-all touch-manipulation"
                  aria-label="סכום לרכישה או מכירה ב-USD"
                  autoComplete="off"
                />
                <div className="flex gap-1 flex-wrap" role="group" aria-label="הקצאה מהירה">
                  {([25, 50, 100] as const).map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setSimAmountUsd(String(Math.max(0, (walletUsd * pct) / 100)))}
                      className="btn-terminal-secondary min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                    >
                      <span className="live-data-number">{pct}%</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleSimBuy}
                  disabled={!simAmountUsd || parseFloat(simAmountUsd) <= 0}
                  aria-label="קנה בסימולציה לפי הסכום שהוזן"
                  className="btn-terminal-accent min-h-[44px] px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 disabled:opacity-50 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                >
                  <ArrowUpCircle className="w-5 h-5" />
                  קנה
                </button>
                <button
                  type="button"
                  onClick={handleSimSell}
                  disabled={!simAmountUsd || parseFloat(simAmountUsd) <= 0}
                  aria-label="מכור בסימולציה לפי הסכום שהוזן"
                  className="btn-terminal-danger min-h-[44px] px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 disabled:opacity-50 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
                >
                  <ArrowDownCircle className="w-5 h-5" />
                  מכור
                </button>
              </div>
              {simError && (
                <p className="mt-2 text-xs text-rose-400" role="status" aria-live="polite">
                  {simError}
                </p>
              )}
            </>
          )}
        </div>

        {/* Evaluate */}
        <div className="ui-panel-dense ui-card frosted-obsidian">
          <div className="flex items-center gap-3 mb-3">
            <RefreshCw className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-bold text-white">{t.feedbackLoop}</h2>
          </div>
          <p className="text-sm text-zinc-500 mb-4">
            אימות תחזיות ממתינות מול מחירי שוק נוכחיים.
          </p>
          <button
            onClick={handleEvaluate}
            disabled={evaluating}
            aria-label="הערך תחזיות עבר"
            className="btn-terminal-secondary w-full min-h-[44px] py-2.5 px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-70 touch-manipulation"
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
            className="frosted-obsidian bg-rose-500/10 border border-rose-500/20 text-rose-500 p-4 rounded-xl flex items-start gap-3"
            role="status"
            aria-live="polite"
          >
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">{error}</div>
          </motion.div>
        )}

        {error ? (
          <div className="frosted-obsidian min-h-[280px] flex flex-col items-center justify-center text-center p-6 rounded-2xl border border-white/5">
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-rose-500" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">הניתוח נכשל</h3>
            <p className="text-sm text-zinc-500 max-w-md" dir="rtl">
              {error}
            </p>
            <p className="text-xs text-zinc-600 mt-2 max-w-md" dir="rtl">
              אין נתונים להצגה עבור הניתוח האחרון. אם השגיאה קשורה להרשאה — התנתק והתחבר מחדש.
            </p>
          </div>
        ) : latestPrediction ? (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-amber-500" />
              {t.latestPrediction}
            </h3>
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="frosted-obsidian border border-white/5 rounded-2xl overflow-hidden min-w-0 max-w-full"
            >
              <div
                className={`p-6 border-b border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 min-w-0 ${
                  latestPrediction.predicted_direction === 'Bullish'
                    ? 'bg-emerald-500/10'
                    : latestPrediction.predicted_direction === 'Bearish'
                      ? 'bg-rose-500/10'
                      : 'bg-zinc-900/60'
                }`}
              >
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm text-zinc-500 mb-1">תוצאה עבור</div>
                    <h2 className="text-xl sm:text-3xl font-bold text-white break-all">{latestPrediction.symbol}</h2>
                  </div>
                  {(latestPrediction.risk_status === 'extreme_fear' ||
                    latestPrediction.risk_status === 'extreme_greed') && (
                    <span className="flex items-center gap-1.5 text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 rounded-lg text-xs font-semibold">
                      <AlertTriangle className="w-4 h-4" />
                      סנטימנט קיצוני
                    </span>
                  )}
                </div>
                <div
                  className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold ${
                    latestPrediction.predicted_direction === 'Bullish'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : latestPrediction.predicted_direction === 'Bearish'
                        ? 'bg-rose-500/20 text-rose-500'
                        : 'bg-zinc-800/80 text-zinc-300'
                  }`}
                >
                  {latestPrediction.predicted_direction === 'Bullish' && <TrendingUp className="w-5 h-5" />}
                  {latestPrediction.predicted_direction === 'Bearish' && <TrendingDown className="w-5 h-5" />}
                  {latestPrediction.predicted_direction === 'Neutral' && <Minus className="w-5 h-5" />}
                  {DIRECTION_HE[latestPrediction.predicted_direction] ?? latestPrediction.predicted_direction}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-white/5 border-b border-white/5 min-w-0">
                <div className="p-6 min-w-0">
                  <div className="text-[10px] sm:text-xs text-zinc-500 uppercase tracking-wider mb-1">הסתברות</div>
                  <div className="text-lg sm:text-2xl font-semibold text-white truncate"><span dir="ltr" className="live-data-number">{latestPrediction.probability != null ? `${latestPrediction.probability}%` : '—'}</span></div>
                </div>
                <div className="p-6 min-w-0">
                  <div className="text-[10px] sm:text-xs text-zinc-500 uppercase tracking-wider mb-1">תנועה צפויה</div>
                  <div className="text-lg sm:text-2xl font-semibold text-white truncate">
                    <span dir="ltr" className="live-data-number">{(latestPrediction.target_percentage ?? 0) > 0 ? '+' : ''}{latestPrediction.target_percentage ?? 0}%</span>
                  </div>
                </div>
                <div className="p-6 col-span-2 sm:col-span-1 min-w-0">
                  <div className="text-[10px] sm:text-xs text-zinc-500 uppercase tracking-wider mb-1">מחיר כניסה</div>
                  <div className="text-lg sm:text-2xl font-semibold text-white truncate" suppressHydrationWarning>
                    <span dir="ltr" className="live-data-number">${(latestPrediction.entry_price ?? 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-white/5 border-b border-white/5">
                <div className="p-6">
                  <div className="text-[10px] text-zinc-500 uppercase mb-1">מודל</div>
                  <div className="text-sm font-semibold text-zinc-100">{latestPrediction.model_name || '—'}</div>
                </div>
                <div className="p-6">
                  <div className="text-[10px] text-zinc-500 uppercase mb-1">זמן תגובה</div>
                  <div className="text-sm font-semibold text-zinc-100">
                    <span className="live-data-number">{latestPrediction.latency_ms ? `${latestPrediction.latency_ms} ms` : '—'}</span>
                  </div>
                </div>
                <div className="p-6">
                  <div className="text-[10px] text-zinc-500 uppercase mb-1">תיקון</div>
                  <div className="text-sm font-semibold text-zinc-100">
                    {latestPrediction.validation_repaired ? 'כן' : 'לא'}
                  </div>
                </div>
                <div className="p-6">
                  <div className="text-[10px] text-zinc-500 uppercase mb-1">סנטימנט</div>
                  <div className="text-sm font-semibold text-zinc-100">
                    {typeof latestPrediction.sentiment_score === 'number'
                      ? latestPrediction.sentiment_score >= 0
                        ? <span className="live-data-number">{`+${latestPrediction.sentiment_score.toFixed(2)}`}</span>
                        : <span className="live-data-number">{latestPrediction.sentiment_score.toFixed(2)}</span>
                      : '—'}
                  </div>
                </div>
              </div>

              {chartData.length > 0 && (
                <div className="p-6 border-b border-white/5">
                  <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-4">
                    גרף מסחר (TradingView) — מחיר חי {latestPrediction.entry_price != null || latestPrediction.suggested_tp != null || latestPrediction.suggested_sl != null ? '· אזור כניסה, TP, SL' : ''}
                  </h3>
                  <div className="h-48 sm:h-64 w-full min-h-[200px]">
                    <TradingChart
                      data={tradingChartProps.data}
                      entry_zone={tradingChartProps.entry_zone}
                      take_profit_targets={tradingChartProps.take_profit_targets}
                      stop_loss_level={tradingChartProps.stop_loss_level}
                      height={256}
                      className="w-full rounded-lg overflow-hidden"
                    />
                  </div>
                  <h3 className="text-xs text-zinc-500 uppercase tracking-wider mt-4 mb-2">
                    היסטוריית מחירים + ביצועי סימולציה
                  </h3>
                  <div className="h-48 sm:h-64 w-full min-h-[200px]">
                    <PriceHistoryChart
                      data={chartData}
                      executionMarkers={executionMarkers}
                      eliteCandleIndex={
                        eliteSymbolSet?.has(symbol) && chartData.length > 0 ? chartData.length - 1 : undefined
                      }
                    />
                  </div>
                </div>
              )}

              {/* Tactical Strategy Card: ATR-based SL/TP + HVN + Gemini opinion */}
              {(latestPrediction.suggested_sl != null || latestPrediction.suggested_tp != null || (latestPrediction.hvn_levels?.length ?? 0) > 0 || latestPrediction.tactical_opinion_he) && (
                <div className="p-6 border-b border-white/5 bg-gradient-to-b from-cyan-500/5 to-transparent border-s-4 border-cyan-500/40" dir="rtl">
                  <h3 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    כרטיס אסטרטגיה טקטית (ATR + HVN)
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    {latestPrediction.suggested_sl != null && (
                      <div className="rounded-lg bg-black/20 p-3 border border-rose-500/20">
                        <p className="text-[10px] text-rose-400/90 uppercase mb-0.5">סטופ לוס מוצע</p>
                        <p className="text-sm font-bold text-white tabular-nums live-data-number">${latestPrediction.suggested_sl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</p>
                      </div>
                    )}
                    {latestPrediction.suggested_tp != null && (
                      <div className="rounded-lg bg-black/20 p-3 border border-emerald-500/20">
                        <p className="text-[10px] text-emerald-400/90 uppercase mb-0.5">יעד רווח מוצע</p>
                        <p className="text-sm font-bold text-white tabular-nums live-data-number">${latestPrediction.suggested_tp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</p>
                      </div>
                    )}
                    {(latestPrediction.hvn_levels?.length ?? 0) > 0 && (
                      <div className="col-span-2 rounded-lg bg-black/20 p-3 border border-cyan-500/20">
                        <p className="text-[10px] text-cyan-400/90 uppercase mb-1">רמות HVN (תמיכה/התנגדות)</p>
                        <p className="text-xs font-medium text-zinc-300 tabular-nums live-data-number" dir="ltr">
                          {latestPrediction.hvn_levels!.map((v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`).join(' · ')}
                        </p>
                      </div>
                    )}
                  </div>
                  {latestPrediction.tactical_opinion_he && (
                    <p className="text-sm text-cyan-100/90 leading-relaxed" dir="rtl">
                      {latestPrediction.tactical_opinion_he}
                    </p>
                  )}
                </div>
              )}

              {/* השורה התחתונה — explicit beginner-friendly 1–2 sentence summary above experts */}
              {latestPrediction.bottom_line_he && (
                <div className="p-6 border-b border-white/5 bg-gradient-to-b from-amber-500/10 to-transparent border-s-4 border-amber-500/50 rounded-xl mx-4 mb-4" dir="rtl">
                  <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" aria-hidden />
                    השורה התחתונה
                  </h3>
                  <p className="text-base font-medium text-zinc-100 leading-relaxed" dir="rtl">
                    {latestPrediction.bottom_line_he}
                  </p>
                  <p className="text-xs text-zinc-500 mt-2">סיכום פשוט להבנה מיידית — לא ייעוץ השקעות.</p>
                </div>
              )}

              {/* Neural Consensus & Debate Room — 6-Agent Board (3x2 grid) + Board Decision */}
              {(typeof latestPrediction.tech_score === 'number' || typeof latestPrediction.risk_score === 'number' || typeof latestPrediction.psych_score === 'number' || typeof latestPrediction.macro_score === 'number' || typeof latestPrediction.onchain_score === 'number' || typeof latestPrediction.deep_memory_score === 'number' || latestPrediction.master_insight_he) && (
                <div className="p-6 border-b border-white/5 bg-gradient-to-b from-violet-500/5 to-transparent border-s-4 border-violet-500/40" dir="rtl">
                  <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <BarChart2 className="w-4 h-4" />
                    קונצנזוס נוירלי — חדר דיונים (6 מומחים)
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    {[
                      ['טכני', latestPrediction.tech_score ?? 0],
                      ['סיכון', latestPrediction.risk_score ?? 0],
                      ['פסיכולוגיית שוק', latestPrediction.psych_score ?? 0],
                      ['מקרו / Order Book', latestPrediction.macro_score ?? 0],
                      ['On-Chain', latestPrediction.onchain_score ?? 0],
                      ['Deep Memory', latestPrediction.deep_memory_score ?? 0],
                    ].map(([label, value]) => {
                      const num = Number(value);
                      const pct = Math.max(0, Math.min(100, num));
                      const colorClass = pct >= 65 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-rose-500';
                      const isMacro = label === 'מקרו / Order Book';
                      return (
                        <div key={String(label)} className="flex flex-col gap-1.5 rounded-lg bg-black/20 border border-violet-500/10 p-2.5">
                          <span className="text-[10px] font-medium text-zinc-400 flex items-center gap-1">
                            {isMacro && <Globe className="w-3 h-3 text-violet-400/80" aria-hidden />}
                            {label}
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden min-w-0">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-white tabular-nums live-data-number shrink-0">{Math.round(pct)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {latestPrediction.macro_logic?.trim() && (
                    <div className="rounded-lg bg-black/20 border border-violet-500/15 p-3 mb-3">
                      <p className="text-[10px] font-semibold text-violet-400/80 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <Globe className="w-3 h-3" /> מקרו / Order Book
                      </p>
                      <p className="text-xs text-zinc-300 leading-relaxed" dir="rtl">{latestPrediction.macro_logic}</p>
                    </div>
                  )}
                  {latestPrediction.onchain_logic?.trim() && (
                    <div className="rounded-lg bg-black/20 border border-violet-500/15 p-3 mb-3">
                      <p className="text-[10px] font-semibold text-violet-400/80 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <Database className="w-3 h-3" /> On-Chain Sleuth
                      </p>
                      <p className="text-xs text-zinc-300 leading-relaxed" dir="rtl">{latestPrediction.onchain_logic}</p>
                    </div>
                  )}
                  {latestPrediction.deep_memory_logic?.trim() && (
                    <div className="rounded-lg bg-black/20 border border-violet-500/15 p-3 mb-3">
                      <p className="text-[10px] font-semibold text-violet-400/80 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <Brain className="w-3 h-3" /> Deep Memory (Vector)
                      </p>
                      <p className="text-xs text-zinc-300 leading-relaxed" dir="rtl">{latestPrediction.deep_memory_logic}</p>
                    </div>
                  )}
                  {latestPrediction.master_insight_he && (
                    <div className="rounded-xl bg-black/25 border border-violet-500/20 p-4">
                      <p className="text-[10px] font-semibold text-violet-400/90 uppercase tracking-wider mb-2">החלטת הדירקטוריון (AI)</p>
                      <blockquote className="text-sm text-zinc-100 leading-relaxed border-s-2 border-violet-500/50 ps-3" dir="rtl">
                        {latestPrediction.master_insight_he}
                      </blockquote>
                    </div>
                  )}
                </div>
              )}

              {(latestPrediction.risk_level_he || latestPrediction.forecast_24h_he) && (
                <div className="p-6 border-b border-white/5 bg-white/[0.02]">
                  <h3 className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-2">דוח עברית</h3>
                  {latestPrediction.risk_level_he && (
                    <p
                      className={`text-xs mb-1 ${String(latestPrediction.risk_level_he).includes('גבוה') ? 'text-rose-500' : String(latestPrediction.risk_level_he).includes('נמוך') ? 'text-emerald-400' : 'text-amber-500'}`}
                      dir="rtl"
                    >
                      {latestPrediction.risk_level_he}
                    </p>
                  )}
                  {latestPrediction.forecast_24h_he && (
                    <p className="text-zinc-500 text-xs" dir="rtl">{latestPrediction.forecast_24h_he}</p>
                  )}
                </div>
              )}
              <div className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-5 h-5 text-amber-500" />
                  <h3 className="text-sm font-bold text-white">לוגיקת AI</h3>
                </div>
                <p className="text-zinc-400 text-sm leading-relaxed break-words" dir="rtl">
                  {latestPrediction.logic ?? 'לא זמין'}
                </p>
                {(latestPrediction.strategic_advice?.trim?.() ?? '') && (
                  <div className="mt-5 pt-5 border-t border-white/5">
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-2">המלצה אסטרטגית</h4>
                    <p className="text-zinc-400 text-sm leading-relaxed" dir="rtl">
                      {latestPrediction.strategic_advice ?? 'לא זמין'}
                    </p>
                  </div>
                )}
                {(latestPrediction.learning_context?.trim?.() ?? '') && (
                  <div className="mt-5 pt-5 border-t border-white/5">
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-2">הקשר למידה</h4>
                    <p className="text-zinc-400 text-sm leading-relaxed" dir="rtl">
                      {latestPrediction.learning_context ?? 'לא זמין'}
                    </p>
                  </div>
                )}
                {((latestPrediction.sources?.length ?? 0) > 0) && (
                  <div className="mt-5 pt-5 border-t border-white/5">
                    <h4 className="text-xs font-semibold text-zinc-500 uppercase mb-2">מקורות</h4>
                    <div className="space-y-2">
                      {(latestPrediction.sources ?? []).map((source, idx) => (
                        <div
                          key={`${source?.source_name ?? idx}-${idx}`}
                          className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
                        >
                          <div className="text-xs font-semibold text-zinc-100">{source?.source_name ?? 'לא זמין'}</div>
                          <div className="text-[11px] text-zinc-500">
                            {source?.source_type ?? '—'} • ציון <span className="live-data-number">{Number(source?.relevance_score ?? 0).toFixed(2)}</span>
                          </div>
                          <div className="text-[11px] text-zinc-500">{source?.evidence_snippet ?? 'לא זמין'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Simulation trades for this symbol */}
            {simulationTrades.length > 0 && (
              <div className="frosted-obsidian border border-white/5 rounded-2xl p-6">
                <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-amber-500" />
                  היסטוריית סימולציה — {symbol}
                </h3>
                <ul className="space-y-2 max-h-48 overflow-auto">
                  {simulationTrades.slice(0, 20).map((tr) => (
                    <li
                      key={tr.id}
                      className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-white/[0.02] border border-white/5 text-sm transition-colors duration-300 hover:bg-white/[0.04]"
                    >
                      <span
                        className={
                          tr.side === 'buy' ? 'text-emerald-400 font-medium' : 'text-rose-500 font-medium'
                        }
                      >
                        {tr.side === 'buy' ? 'קנייה' : 'מכירה'}
                      </span>
                      <span className="text-zinc-100 live-data-number">
                        ${tr.amountUsd.toFixed(0)} @ ${tr.price.toLocaleString()}
                      </span>
                      <span className="text-zinc-500 text-xs" suppressHydrationWarning>{tr.dateLabel}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="frosted-obsidian border border-white/5 rounded-xl p-6 transition-all duration-300 hover:bg-white/[0.02]">
                <div className="text-[10px] uppercase text-zinc-500 tracking-wider">תוקן</div>
                <div className="text-xl font-bold text-white mt-0.5">{repairedCount}</div>
              </div>
              <div className="frosted-obsidian border border-white/5 rounded-xl p-6 transition-all duration-300 hover:bg-white/[0.02]">
                <div className="text-[10px] uppercase text-zinc-500 tracking-wider">גיבוי</div>
                <div className="text-xl font-bold text-white mt-0.5">{fallbackCount}</div>
              </div>
              <div className="frosted-obsidian border border-white/5 rounded-xl p-6 transition-all duration-300 hover:bg-white/[0.02]">
                <div className="text-[10px] uppercase text-zinc-500 tracking-wider">עם מקורות</div>
                <div className="text-xl font-bold text-white mt-0.5">{withSourcesCount}</div>
              </div>
              <div className="frosted-obsidian border border-white/5 rounded-xl p-6 transition-all duration-300 hover:bg-white/[0.02]">
                <div className="text-[10px] uppercase text-zinc-500 tracking-wider">זמן ממוצע</div>
                <div className="text-xl font-bold text-white mt-0.5">
                  <span className="live-data-number">{Number.isFinite(avgLatency) ? `${Math.round(avgLatency)} ms` : '—'}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="frosted-obsidian min-h-[280px] flex flex-col items-center justify-center text-center p-6 rounded-2xl border border-white/5">
            <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center mb-4">
              <BarChart2 className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">אין עדיין תחזיות</h3>
            <p className="text-sm text-zinc-500 max-w-sm">
              בחר נכס (BTC, ETH, SOL) ולחץ על הרץ ניתוח כדי להתחיל.
            </p>
          </div>
        )}

        {/* Prediction history */}
        {history.length > 0 && (
          <div className="space-y-4 pt-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-500" />
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
                  className="frosted-obsidian border border-white/5 rounded-xl p-6 transition-all duration-300 hover:bg-white/[0.02]"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white">{record.symbol}</span>
                      <span className="text-xs text-zinc-500" suppressHydrationWarning>
                        {new Date(record.prediction_date).toLocaleString('he-IL')}
                      </span>
                      {(record.risk_status === 'extreme_fear' || record.risk_status === 'extreme_greed') && (
                        <span className="flex items-center gap-1 text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md text-[10px] font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          קיצוני
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-md ${
                          record.predicted_direction === 'Bullish'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : record.predicted_direction === 'Bearish'
                              ? 'bg-rose-500/20 text-rose-500'
                              : 'bg-zinc-800/80 text-zinc-300'
                        }`}
                      >
                        {(DIRECTION_HE[record.predicted_direction] ?? record.predicted_direction)} (<span className="live-data-number">{record.probability}%</span>)
                      </span>
                      {typeof record.sentiment_score === 'number' && (
                        <span className="text-xs px-2 py-1 rounded-md bg-zinc-800/80 text-zinc-300">
                          סנטימנט: {record.sentiment_score >= 0 ? '+' : ''}
                          <span className="live-data-number">{record.sentiment_score.toFixed(2)}</span>
                        </span>
                      )}
                      {record.status === 'pending' ? (
                        <span className="flex items-center gap-1 text-xs text-amber-500 bg-amber-500/10 px-2 py-1 rounded-md">
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
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <div className="text-xs text-zinc-500 mb-1">תוצאה: {record.actual_outcome}</div>
                      <div className="bg-white/[0.02] rounded-lg p-3 text-sm text-zinc-400 border border-white/5" dir="rtl">
                        <span className="font-semibold text-zinc-100 ms-1">מסקנת למידה:</span>
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
                aria-label="טען עוד פריטים מהיסטוריית הניתוח"
                className="btn-terminal-secondary w-full min-h-[44px] mt-2 py-2.5 px-4 rounded-xl font-medium text-sm touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
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
