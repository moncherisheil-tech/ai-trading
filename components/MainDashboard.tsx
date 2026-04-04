'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  BarChart2,
  BrainCircuit,
  Cpu,
  Shield,
} from 'lucide-react';
import GemsStrip from '@/components/GemsStrip';
import MarketSafetyBanner from '@/components/MarketSafetyBanner';
import PaperTradingPanel from '@/components/PaperTradingPanel';
import AIAccuracyChart from '@/components/AIAccuracyChart';
import DeepMemoryFeed from '@/components/DeepMemoryFeed';
import BoardOfExperts from '@/components/BoardOfExperts';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMarketState } from '@/context/MarketStateContext';

const GLASS =
  'frosted-obsidian panel-sovereign-diamond sovereign-tilt rounded-3xl';

const staggerContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.22,
    },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 100, damping: 20 },
  },
};

const CryptoAnalyzer = dynamic(() => import('@/components/CryptoAnalyzer'), {
  loading: () => (
    <div className="w-full min-w-0 p-6 space-y-4" dir="rtl" aria-live="polite">
      <div className="cyber-decrypt text-xs font-semibold tracking-[0.3em]" data-scramble="7X-NEURAL-KEY">
        מאתחל קונצנזוס
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  ),
});

type MarketMode = 'bull' | 'bear';

function TerminalClock() {
  const [now, setNow] = useState<string>('');
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleString('he-IL', {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="font-mono text-xs sm:text-sm text-cyan-400/90 tabular-nums tracking-tight text-end">
      <span className="ui-label text-zinc-400 text-xs block sm:inline sm:me-3">שעון מקומי</span>
      {now}
    </div>
  );
}

/**
 * Bloomberg-style terminal dashboard: bento grid + glass cards + Deep Memory stream.
 */
export default function MainDashboard() {
  const { isDefcon1, defcon, sentiment, volatilityNormalized, loading: marketLoading } = useMarketState();

  // Derive market mode directly from the already-polling MarketStateContext.
  // This eliminates the duplicate getMarketRiskSentinelAction setInterval that
  // was previously firing every 20 s redundantly alongside the 18 s context poll.
  const marketMode: MarketMode = sentiment?.status === 'DANGEROUS' ? 'bear' : 'bull';
  const isBootstrapping = marketLoading && sentiment === null;

  return (
    <section
      data-defcon={defcon}
      data-defcon1={isDefcon1 ? '1' : '0'}
      className={`relative z-[2] min-h-screen bg-transparent text-zinc-100 overflow-x-hidden transition-colors duration-500 ${
        marketMode === 'bull' ? 'market-mode-bull' : 'market-mode-bear'
      } ${isDefcon1 ? 'defcon-terminal' : ''}`}
      dir="rtl"
    >
      <div className="pointer-events-none absolute inset-0 council-vignette" aria-hidden />
      {isBootstrapping ? (
        <div className="relative z-[3] mx-auto mb-4 max-w-[1680px] px-4 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-cyan-400/25 bg-cyan-950/35 px-4 py-2 text-sm text-cyan-200">
            <span className="ui-label tracking-wide">מסנכרן מדדי סיכון שוק…</span>
          </div>
        </div>
      ) : null}

      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        variants={staggerContainer}
        className="relative max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10 w-full min-w-0"
      >
        {/* Command strip */}
        <motion.header variants={staggerItem} className={`${GLASS} z-depth-2 mb-6 px-5 py-4 sm:px-6 flex flex-wrap items-center justify-between gap-4`}>
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15 border border-cyan-500/30 shadow-[0_0_24px_rgba(6,182,212,0.2)]">
              <Activity className="h-5 w-5 text-cyan-300" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="ui-label text-xs font-semibold tracking-wide text-cyan-200">מועצת ה-AI</p>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">מסוף ריבונות</h1>
              <p className="ui-label text-sm text-zinc-300 mt-0.5 hidden sm:block">סימולציה ולימוד בלבד · אין זה ייעוץ השקעות</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <span className={`ui-label text-xs tracking-wide px-3 py-1 rounded-full border live-data-number tabular-nums tracking-tight ${marketMode === 'bull' ? 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10' : 'text-rose-300 border-rose-400/40 bg-rose-500/10'}`}>
              {marketMode === 'bull' ? 'מצב שור' : 'מצב דוב'}
            </span>
            <span
              className={`text-xs px-3 py-1 rounded-full border font-mono tabular-nums tracking-tight ${
                isDefcon1
                  ? 'text-rose-200 border-rose-500/60 bg-rose-950/50 ring-1 ring-rose-500/30'
                  : defcon === 2
                    ? 'text-amber-200 border-amber-500/40 bg-amber-950/30'
                    : 'text-cyan-200/80 border-cyan-500/30 bg-cyan-950/20'
              }`}
              title={sentiment?.reasoning ?? ''}
            >
              DEFCON {defcon}
              {volatilityNormalized > 0.55 ? ' · תנודתיות גבוהה' : ''}
            </span>
            <div className="hidden sm:flex items-center gap-2 ui-label text-xs tracking-wide text-zinc-400">
              <Cpu className="h-3.5 w-3.5 text-cyan-500/70" />
              <span>קונצנזוס · זיכרון עמוק</span>
            </div>
            <TerminalClock />
          </div>
        </motion.header>

        <BoardOfExperts staggerItem={staggerItem} />

        <motion.div variants={staggerItem} className="grid grid-cols-1 lg:grid-cols-12 auto-rows-[minmax(160px,auto)] gap-x-5 gap-y-7 lg:gap-x-7 lg:gap-y-8">
          {/* Deep Memory — prominent */}
          <DeepMemoryFeed
            className="lg:col-span-4 xl:col-span-3 min-h-[320px] lg:min-h-[380px] lg:row-span-2"
          />

          <div
            className={`${GLASS} neural-pulse-border sovereign-tilt z-depth-2 overflow-hidden flex flex-col lg:col-span-4 xl:col-span-6 lg:row-span-2 shadow-[0_20px_44px_rgba(0,0,0,0.45)]`}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10 bg-black/20 shrink-0">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-5 w-5 text-cyan-300" />
                <span className="ui-label text-sm font-semibold text-cyan-100/90">ליבת המפקח</span>
              </div>
              <span className="ui-label text-xs live-data-number tabular-nums text-zinc-300">
                סריקה נוירלית
              </span>
            </div>
            <div className="flex-1 min-h-0 p-4 sm:p-5 overflow-y-auto">
              <CryptoAnalyzer />
            </div>
          </div>

          {/* Market pulse stack */}
          <div
            className={`${GLASS} sovereign-tilt z-depth-2 overflow-hidden flex flex-col lg:col-span-4 xl:col-span-3`}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-black/15">
              <Shield className="h-4 w-4 text-emerald-400/90" aria-hidden />
              <span className="ui-label text-sm font-semibold text-zinc-100">סטטוס שוק</span>
            </div>
            <MarketSafetyBanner />
            <div className="border-t border-white/5 flex-1 min-h-0">
              <GemsStrip />
            </div>
          </div>

          {/* Quick stat tiles */}
          <div
            className={`${GLASS} sovereign-tilt z-depth-1 p-5 flex flex-col justify-center gap-4 lg:col-span-4 xl:col-span-3`}
          >
            <div className="flex items-start gap-3">
              <BarChart2 className="h-5 w-5 text-cyan-400/80 shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="ui-label text-xs font-semibold text-zinc-300">אנליטיקה</p>
                <p className="text-sm font-semibold text-zinc-200 leading-snug">דיוק AI ומגמות ביצועים בזמן אמת</p>
              </div>
            </div>
            <div className="h-px bg-white/5" />
            <p className="text-xs text-zinc-400 leading-relaxed">
              הנתונים מסונכרנים עם מנוע הקונצנזוס והזיכרון העמוק. לפרטים מלאים — לוח הביצועים.
            </p>
          </div>

          {/* Execution engine — panel ships its own glass bento */}
          <div className="lg:col-span-8 xl:col-span-9 min-w-0">
            <PaperTradingPanel />
          </div>

          {/* AI accuracy */}
          <div
            className={`${GLASS} sovereign-tilt z-depth-2 p-5 sm:p-6 lg:col-span-4 xl:col-span-3`}
          >
            <AIAccuracyChart />
          </div>

          <div
            className={`${GLASS} sovereign-tilt z-depth-2 overflow-hidden lg:col-span-8 xl:col-span-9`}
          >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-black/20">
              <Cpu className="h-4 w-4 text-amber-400/90" />
              <span className="ui-label text-sm font-semibold text-zinc-200">מנוע מודיעין ביצועים</span>
            </div>
            <div className="p-4 sm:p-6 overflow-x-hidden">
              <div className="cyber-decrypt text-xs tracking-[0.24em] font-semibold mb-4" data-scramble="DATA-LINK-SECURE">
                טלמטריה חיה — מוכנה
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">
                זרם הנתונים משלב שבעה מומחי AI, מנוע קונצנזוס וזיכרון עמוק. המדדים מתעדכנים ברציפות.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
