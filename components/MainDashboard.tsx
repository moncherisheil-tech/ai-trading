'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Activity, BarChart2, Cpu, Shield } from 'lucide-react';
import GemsStrip from '@/components/GemsStrip';
import MarketSafetyBanner from '@/components/MarketSafetyBanner';
import PaperTradingPanel from '@/components/PaperTradingPanel';
import AIAccuracyChart from '@/components/AIAccuracyChart';
import DeepMemoryFeed from '@/components/DeepMemoryFeed';
import { Skeleton } from '@/components/ui/Skeleton';

const GLASS =
  'bg-zinc-900/60 backdrop-blur-xl border border-white/5 rounded-3xl shadow-2xl';

const CryptoAnalyzer = dynamic(() => import('@/components/CryptoAnalyzer'), {
  loading: () => (
    <div className="w-full min-w-0 p-6 space-y-4" dir="rtl">
      <Skeleton className="h-8 w-48 rounded-lg" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  ),
});

function TerminalClock() {
  const [now, setNow] = useState<string>('');
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleString('en-GB', {
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
      <span className="text-zinc-500 text-[10px] uppercase tracking-widest block sm:inline sm:me-3">UTC+local</span>
      {now}
    </div>
  );
}

/**
 * Bloomberg-style terminal dashboard: bento grid + glass cards + Deep Memory stream.
 */
export default function MainDashboard() {
  return (
    <section
      className="relative min-h-screen bg-[#030306] text-zinc-100 overflow-x-hidden"
      dir="rtl"
    >
      {/* Terminal ambience */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.4]"
        aria-hidden
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(900px 400px at 15% 0%, rgba(245,158,11,0.07), transparent 55%), radial-gradient(700px 380px at 95% 10%, rgba(34,211,238,0.06), transparent 50%), radial-gradient(600px 300px at 50% 100%, rgba(139,92,246,0.05), transparent 45%)',
        }}
      />

      <div className="relative max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10 w-full min-w-0">
        {/* Command strip */}
        <header className={`${GLASS} mb-6 px-5 py-4 sm:px-6 flex flex-wrap items-center justify-between gap-4`}>
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 border border-amber-500/20 shadow-[0_0_24px_rgba(245,158,11,0.15)]">
              <Activity className="h-5 w-5 text-amber-400" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-amber-500/80">Quantum Terminal</p>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">לוח בקרה ראשי</h1>
              <p className="text-xs text-zinc-500 mt-0.5 hidden sm:block">סימולציה ולימוד בלבד · לא ייעוץ השקעות</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
              <Cpu className="h-3.5 w-3.5 text-cyan-500/70" />
              <span>Consensus · Deep Memory</span>
            </div>
            <TerminalClock />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {/* Deep Memory — prominent */}
          <DeepMemoryFeed className="lg:col-span-2 xl:col-span-2 min-h-[320px] lg:min-h-[380px] lg:row-span-2" />

          {/* Market pulse stack */}
          <div className={`${GLASS} overflow-hidden flex flex-col lg:col-span-1 xl:col-span-1`}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-black/15">
              <Shield className="h-4 w-4 text-emerald-400/90" aria-hidden />
              <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">סטטוס שוק</span>
            </div>
            <MarketSafetyBanner />
            <div className="border-t border-white/5 flex-1 min-h-0">
              <GemsStrip />
            </div>
          </div>

          {/* Quick stat tiles */}
          <div className={`${GLASS} p-5 flex flex-col justify-center gap-4 lg:col-span-1 xl:col-span-1`}>
            <div className="flex items-start gap-3">
              <BarChart2 className="h-5 w-5 text-cyan-400/80 shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Analytics</p>
                <p className="text-sm font-semibold text-zinc-200 leading-snug">דיוק AI ומגמות ביצועים בזמן אמת</p>
              </div>
            </div>
            <div className="h-px bg-white/5" />
            <p className="text-xs text-zinc-500 leading-relaxed">
              הנתונים מסונכרנים עם מנוע הקונצנזוס והזיכרון העמוק. השתמש בלוח הביצועים לפרטים מלאים.
            </p>
          </div>

          {/* Execution engine — panel ships its own glass bento */}
          <div className="lg:col-span-3 xl:col-span-4 min-w-0">
            <PaperTradingPanel />
          </div>

          {/* AI accuracy */}
          <div className={`${GLASS} p-5 sm:p-6 lg:col-span-2 xl:col-span-2`}>
            <AIAccuracyChart />
          </div>

          {/* Analyzer — full width */}
          <div className={`${GLASS} overflow-hidden lg:col-span-3 xl:col-span-4`}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-black/20">
              <Cpu className="h-4 w-4 text-amber-400/90" />
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">ניתוח קריפטו · קונצנזוס</span>
            </div>
            <div className="p-4 sm:p-6 overflow-x-hidden">
              <CryptoAnalyzer />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
