'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Brain, BarChart2, ChevronLeft, AlertTriangle, Rocket, Loader2 } from 'lucide-react';
import { createVirtualPortfolioTradeAction, getHistory } from '@/app/actions';
import type { PredictionRecord } from '@/lib/db';
import DashboardCard from '@/components/DashboardCard';

const DEFAULT_VIRTUAL_AMOUNT_USD = 100;

const DIRECTION_HE: Record<string, string> = {
  Bullish: 'שורי',
  Bearish: 'דובי',
  Neutral: 'ניטרלי',
};

export default function InsightsPage() {
  const [history, setHistory] = useState<PredictionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const [simulateMessage, setSimulateMessage] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    getHistory()
      .then((data) => setHistory(data.slice(0, 30)))
      .catch(() => setError('טעינת תובנות נכשלה.'))
      .finally(() => setLoading(false));
  }, []);

  const triggerSimulation = async (record: PredictionRecord) => {
    const id = record.id;
    setSimulatingId(id);
    setSimulateMessage(null);
    const symbol = record.symbol?.endsWith('USDT') ? record.symbol : `${record.symbol}USDT`;
    const entryPrice = record.entry_price ?? 0;
    if (entryPrice <= 0) {
      setSimulateMessage({ id, text: 'מחיר כניסה חסר.', ok: false });
      setSimulatingId(null);
      return;
    }
    try {
      const out = await createVirtualPortfolioTradeAction({
        symbol,
        entry_price: entryPrice,
        amount_usd: DEFAULT_VIRTUAL_AMOUNT_USD,
      });
      if (out.success) {
        setSimulateMessage({ id, text: 'סימולציה נרשמה בתיק הוירטואלי.', ok: true });
      } else {
        setSimulateMessage({ id, text: out.error ?? 'שגיאה ברישום.', ok: false });
      }
    } catch {
      setSimulateMessage({ id, text: 'שגיאת רשת.', ok: false });
    } finally {
      setSimulatingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-900 text-zinc-100 overflow-x-hidden pb-24 sm:pb-8" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold text-zinc-100 flex items-center gap-3"
        >
          <span className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
            <Brain className="w-6 h-6" />
          </span>
          תובנות AI
        </motion.h1>

        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300"
          >
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-zinc-800/80 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <DashboardCard>
            <div className="p-8 text-center text-zinc-400">
              <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">אין עדיין תחזיות. הרץ ניתוח בעמוד הסריקה.</p>
              <Link
                href="/"
                className="mt-4 inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 text-sm font-medium"
              >
                <ChevronLeft className="w-4 h-4 rtl:scale-x-[-1]" aria-hidden />
                מעבר לסריקה
              </Link>
            </div>
          </DashboardCard>
        ) : (
          <div className="space-y-4">
            {history.map((record, i) => (
              <DashboardCard key={record.id} delay={i * 0.04}>
                <div className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="font-bold text-zinc-100">{record.symbol}</span>
                    <span className="text-xs text-zinc-500">
                      {new Date(record.prediction_date).toLocaleString('he-IL')}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                        record.predicted_direction === 'Bullish'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : record.predicted_direction === 'Bearish'
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-zinc-600 text-zinc-300'
                      }`}
                    >
                      {DIRECTION_HE[record.predicted_direction] ?? record.predicted_direction} ({record.probability}%)
                    </span>
                  </div>
                  {record.bottom_line_he && (
                    <p className="text-sm text-zinc-300 mb-2 font-medium" dir="rtl">
                      {record.bottom_line_he}
                    </p>
                  )}
                  {record.risk_level_he && (
                    <p
                      className={`text-xs mb-1 ${String(record.risk_level_he).includes('גבוה') ? 'text-red-400' : String(record.risk_level_he).includes('נמוך') ? 'text-emerald-400' : 'text-amber-400/90'}`}
                      dir="rtl"
                    >
                      {record.risk_level_he}
                    </p>
                  )}
                  {record.forecast_24h_he && (
                    <p className="text-xs text-zinc-400" dir="rtl">
                      {record.forecast_24h_he}
                    </p>
                  )}
                  <p className="text-xs text-zinc-500 mt-2 pt-2 border-t border-zinc-700/80" dir="rtl">
                    {record.logic ?? 'לא זמין'}
                  </p>
                  {record.status === 'evaluated' && (record.error_report ?? record.learning_context) && (
                    <div className="mt-3 pt-3 border-t border-zinc-700/80 rounded-xl bg-amber-500/5 border border-amber-500/20 p-3">
                      <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
                        לקחים שנלמדו / מסקנות AI
                      </h4>
                      {record.error_report && (
                        <p className="text-sm text-zinc-200 mb-2" dir="rtl">
                          {record.error_report}
                        </p>
                      )}
                      {record.learning_context && (
                        <p className="text-xs text-zinc-400" dir="rtl">
                          {record.learning_context}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-zinc-700/80 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => triggerSimulation(record)}
                      disabled={simulatingId === record.id || (record.entry_price ?? 0) <= 0}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 text-sm font-medium hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                    >
                      {simulatingId === record.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Rocket className="w-4 h-4" />
                      )}
                      אשר סימולציה
                    </button>
                    {simulateMessage?.id === record.id && (
                      <span className={`text-xs ${simulateMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                        {simulateMessage.text}
                      </span>
                    )}
                  </div>
                </div>
              </DashboardCard>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
