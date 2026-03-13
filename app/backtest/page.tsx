'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Target,
  BarChart3,
  TrendingUp,
  Award,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  BookOpen,
} from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import type { BacktestAnalyticsResponse } from '@/app/api/backtest/analytics/route';

interface LearningProgressData {
  snapshots: Array<{ date: string; success_rate_pct: number }>;
  latestReport: {
    successSummary: string;
    keyLesson: string;
    actionTaken: string;
    accuracyPct: number;
    created_at?: string;
  } | null;
}

export default function BacktestPage() {
  const [data, setData] = useState<BacktestAnalyticsResponse | null>(null);
  const [learning, setLearning] = useState<LearningProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/backtest/analytics').then((res) => res.json()),
      fetch('/api/retrospective/insights').then((res) => res.json()),
    ])
      .then(([json, learningJson]) => {
        if (json.error) {
          setError(json.error);
          return;
        }
        setData(json as BacktestAnalyticsResponse);
        setLearning(learningJson as LearningProgressData);
      })
      .catch(() => setError('טעינת נתוני בקטסט נכשלה.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-900 text-zinc-100 pb-24" dir="rtl">
        <AppHeader />
        <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
          <p className="text-zinc-400">טוען דשבורד בקטסט...</p>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-zinc-900 text-zinc-100 pb-24" dir="rtl">
        <AppHeader />
        <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col items-center gap-4">
          <AlertCircle className="w-12 h-12 text-red-400" />
          <p className="text-zinc-300 text-center">{error ?? 'אין נתונים'}</p>
        </div>
      </main>
    );
  }

  const { hebrewSummary, outcomes, accuracyByDay } = data;

  return (
    <main className="min-h-screen bg-zinc-900 text-zinc-100 overflow-x-hidden pb-24 sm:pb-8" dir="rtl">
      <AppHeader />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold text-zinc-100 flex items-center gap-3"
        >
          <span className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
            <Target className="w-6 h-6" />
          </span>
          דשבורד בקטסט ואנליטיקה
        </motion.h1>

        {/* Hebrew AI Performance Report */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-2xl border border-amber-500/20 bg-zinc-800/90 p-4 sm:p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold text-amber-400/90 uppercase tracking-wider">
            דוח ביצועי AI
          </h2>
          <p className="text-zinc-200 text-sm leading-relaxed" dir="rtl">
            {data.hebrewSummary.summary}
          </p>
          <p className="text-zinc-300 text-sm leading-relaxed" dir="rtl">
            {data.hebrewSummary.insight}
          </p>
          <p className="text-amber-400/90 text-sm leading-relaxed font-medium" dir="rtl">
            {data.hebrewSummary.recommendation}
          </p>
        </motion.section>

        {/* Learning Progress — accuracy since Retrospective Engine */}
        {learning && (learning.snapshots?.length > 0 || learning.latestReport) && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="rounded-2xl border border-zinc-600/80 bg-zinc-800/80 p-4 sm:p-5 space-y-4"
          >
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-amber-400" />
              התקדמות למידה (מנוע רטרוספקטיבה)
            </h2>
            {learning.snapshots?.length > 0 && (
              <div>
                <div className="text-xs text-zinc-500 mb-2">דיוק לאורך זמן מאז הפעלת המנוע</div>
                <div className="flex items-end gap-1 sm:gap-2 h-14">
                  {[...learning.snapshots].reverse().slice(-14).map((s) => (
                    <div key={s.date} className="flex-1 min-w-0 flex flex-col items-center gap-0.5">
                      <div className="w-full flex flex-col justify-end h-10 rounded-t bg-zinc-700/50 overflow-hidden">
                        <div
                          className="w-full bg-emerald-500/80 rounded-t transition-all"
                          style={{
                            height: `${Math.min(100, s.success_rate_pct)}%`,
                            minHeight: s.success_rate_pct > 0 ? '2px' : '0',
                          }}
                        />
                      </div>
                      <span className="text-[9px] text-zinc-500 truncate w-full text-center">
                        {new Date(s.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {learning.latestReport && (
              <div className="pt-2 border-t border-zinc-700/80 space-y-2">
                <p className="text-zinc-300 text-sm" dir="rtl">{learning.latestReport.successSummary}</p>
                <p className="text-zinc-400 text-xs" dir="rtl"><span className="text-amber-400/90">תובנה:</span> {learning.latestReport.keyLesson}</p>
                <p className="text-zinc-400 text-xs" dir="rtl"><span className="text-amber-400/90">פעולה:</span> {learning.latestReport.actionTaken}</p>
              </div>
            )}
          </motion.section>
        )}

        {/* Top Stats Bar */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          <div className="rounded-2xl border border-zinc-700/80 bg-zinc-800/90 p-4">
            <div className="flex items-center gap-2 text-zinc-500 text-xs uppercase tracking-wider mb-1">
              <BarChart3 className="w-4 h-4" />
              דיוק 24 שעות
            </div>
            <div className="text-2xl font-bold text-amber-400">
              {data.last24hCount > 0
                ? `${data.last24hAccuracyPct.toFixed(1)}%`
                : '—'}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {data.last24hCount} תחזיות ב-24h
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-700/80 bg-zinc-800/90 p-4">
            <div className="flex items-center gap-2 text-zinc-500 text-xs uppercase tracking-wider mb-1">
              <Target className="w-4 h-4" />
              סה"כ נותחו
            </div>
            <div className="text-2xl font-bold text-zinc-100">
              {data.totalPredictions}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              Success Rate: {data.successRatePct.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-700/80 bg-zinc-800/90 p-4">
            <div className="flex items-center gap-2 text-zinc-500 text-xs uppercase tracking-wider mb-1">
              <Award className="w-4 h-4" />
              נכס מוביל
            </div>
            <div className="text-xl font-bold text-amber-400 truncate">
              {data.topPerformingAsset}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {data.topPerformingAssetHitRate > 0
                ? `דיוק ${data.topPerformingAssetHitRate.toFixed(0)}%`
                : '—'}
            </div>
          </div>
        </motion.section>

        {/* Secondary metrics: MAE, Theoretical ROI */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="flex flex-wrap gap-3"
        >
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-4 py-2 flex items-center gap-2">
            <span className="text-zinc-500 text-xs">MAE</span>
            <span className="font-semibold text-zinc-200">{data.mae.toFixed(2)}%</span>
          </div>
          <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/60 px-4 py-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <span className="text-zinc-500 text-xs">Theoretical ROI</span>
            <span
              className={`font-semibold ${
                data.theoreticalRoiPct >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {data.theoreticalRoiPct >= 0 ? '+' : ''}
              {data.theoreticalRoiPct.toFixed(2)}%
            </span>
          </div>
        </motion.section>

        {/* Accuracy trend last 7 days - CSS bars */}
        {accuracyByDay.some((d) => d.total > 0) && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-2xl border border-zinc-700/80 bg-zinc-800/90 p-4"
          >
            <h2 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-400" />
              דיוק לפי יום (7 ימים אחרונים)
            </h2>
            <div className="flex items-end gap-2 sm:gap-3 h-24">
              {accuracyByDay.map((day, i) => (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div className="w-full flex flex-col justify-end h-16 rounded-t-lg bg-zinc-700/50 overflow-hidden">
                    <div
                      className="w-full bg-amber-500/80 transition-all duration-500 rounded-t"
                      style={{
                        height: `${day.total > 0 ? day.accuracyPct : 0}%`,
                        minHeight: day.total > 0 ? '4px' : '0',
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-zinc-500 truncate w-full text-center">
                    {new Date(day.date).toLocaleDateString('he-IL', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    {day.total > 0 ? `${day.accuracyPct.toFixed(0)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {/* Outcome List */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-zinc-700/80 bg-zinc-800/90 overflow-hidden"
        >
          <h2 className="text-sm font-semibold text-zinc-200 p-4 border-b border-zinc-700/80 flex items-center gap-2">
            <Target className="w-4 h-4 text-amber-400" />
            תוצאות היסטוריות
          </h2>
          {outcomes.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              אין עדיין תוצאות. הרץ הערכת תחזיות כדי למלא את הדשבורד.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-700/60 max-h-[60vh] overflow-auto">
              {outcomes.map((o, i) => (
                <li
                  key={o.id}
                  className="p-4 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-zinc-700/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-zinc-100">
                        {o.symbol.replace('USDT', '')}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {new Date(o.evaluated_at).toLocaleString('he-IL', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-400 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>
                        AI: {o.target_percentage != null ? (o.target_percentage >= 0 ? '+' : '') + o.target_percentage.toFixed(1) : '—'}%
                      </span>
                      <span className="text-zinc-500">|</span>
                      <span>
                        בפועל: {(o.price_diff_pct >= 0 ? '+' : '') + o.price_diff_pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {o.isHit ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        HIT
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-600/80 text-zinc-300 border border-zinc-500/50 text-xs font-semibold">
                        <XCircle className="w-3.5 h-3.5" />
                        MISS
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </motion.section>
      </div>
    </main>
  );
}
