'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart2,
  BrainCircuit,
  CandlestickChart,
  Cpu,
  Globe2,
  MessagesSquare,
  Shield,
  Waves,
} from 'lucide-react';
import GemsStrip from '@/components/GemsStrip';
import MarketSafetyBanner from '@/components/MarketSafetyBanner';
import PaperTradingPanel from '@/components/PaperTradingPanel';
import AIAccuracyChart from '@/components/AIAccuracyChart';
import DeepMemoryFeed from '@/components/DeepMemoryFeed';
import { Skeleton } from '@/components/ui/Skeleton';
import { useLocale } from '@/hooks/use-locale';

const GLASS =
  'bg-zinc-900/60 backdrop-blur-xl border border-white/5 rounded-3xl shadow-2xl';

const COUNCIL = [
  { name: 'Technical Analyst', alias: 'The Engineer', icon: CandlestickChart, color: 'text-cyan-300' },
  { name: 'Fundamental Analyst', alias: 'The Professor', icon: Globe2, color: 'text-violet-300' },
  { name: 'Sentiment Analyst', alias: 'The Social Lead', icon: MessagesSquare, color: 'text-fuchsia-300' },
  { name: 'On-Chain/Whale Analyst', alias: 'The Leviathan', icon: Waves, color: 'text-sky-300' },
  { name: 'Risk Manager', alias: 'The Shield', icon: Shield, color: 'text-emerald-300' },
  { name: 'Macro Analyst', alias: 'The Strategist', icon: BarChart2, color: 'text-amber-300' },
  { name: 'AI Overseer', alias: 'The Architect', icon: BrainCircuit, color: 'text-rose-300' },
] as const;

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
  const { locale } = useLocale();
  const [now, setNow] = useState<string>('');
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB', {
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
  }, [locale]);
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
  const { locale, isRtl } = useLocale();
  const [consensusPulse, setConsensusPulse] = useState(false);

  useEffect(() => {
    let mounted = true;

    const syncConsensus = async () => {
      try {
        const res = await fetch('/api/ops/metrics/accuracy', { cache: 'no-store' });
        if (!mounted || !res.ok) return;
        const payload = (await res.json()) as { currentAccuracyPct?: number; success?: boolean };
        const reached = Boolean(payload.success && (payload.currentAccuracyPct ?? 0) >= 75);
        setConsensusPulse(reached);
      } catch {
        if (mounted) setConsensusPulse(false);
      }
    };

    void syncConsensus();
    const timer = setInterval(syncConsensus, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section
      className="relative min-h-screen bg-black text-zinc-100 overflow-x-hidden"
      dir={isRtl ? 'rtl' : 'ltr'}
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
      <div className="pointer-events-none absolute inset-0 council-vignette" aria-hidden />

      <div className="relative max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10 w-full min-w-0">
        {/* Command strip */}
        <header className={`${GLASS} mb-6 px-5 py-4 sm:px-6 flex flex-wrap items-center justify-between gap-4`}>
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15 border border-cyan-500/30 shadow-[0_0_24px_rgba(6,182,212,0.2)]">
              <Activity className="h-5 w-5 text-cyan-300" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-300/85">AI Council Terminal</p>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">{locale === 'he' ? 'לוח בקרה ראשי' : 'Main Dashboard'}</h1>
              <p className="text-xs text-zinc-500 mt-0.5 hidden sm:block">{locale === 'he' ? 'סימולציה ולימוד בלבד · לא ייעוץ השקעות' : 'Simulation and learning only · not investment advice'}</p>
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

        <div className="mb-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-[11px] uppercase tracking-[0.3em] text-cyan-300/90">The 7 Experts</p>
            <p className={`text-xs ${consensusPulse ? 'text-emerald-300' : 'text-zinc-500'}`}>
              {consensusPulse ? 'Consensus Reached' : 'Awaiting Consensus'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-3">
            {COUNCIL.map((expert) => {
              const Icon = expert.icon;
              return (
                <article
                  key={expert.name}
                  className={`rounded-2xl border border-cyan-500/20 bg-zinc-950/70 p-4 backdrop-blur council-card ${consensusPulse ? 'council-card-pulse' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`h-10 w-10 rounded-xl border border-white/10 bg-black/60 flex items-center justify-center ${expert.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="h-2.5 w-2.5 rounded-full bg-cyan-300/70 shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
                  </div>
                  <p className="mt-3 text-sm text-zinc-100 font-semibold leading-tight">{expert.name}</p>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-400 mt-1">{expert.alias}</p>
                </article>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {/* Deep Memory — prominent */}
          <DeepMemoryFeed className="lg:col-span-2 xl:col-span-2 min-h-[320px] lg:min-h-[380px] lg:row-span-2" />

          {/* Market pulse stack */}
          <div className={`${GLASS} overflow-hidden flex flex-col lg:col-span-1 xl:col-span-1`}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-black/15">
              <Shield className="h-4 w-4 text-emerald-400/90" aria-hidden />
              <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">{locale === 'he' ? 'סטטוס שוק' : 'Market Status'}</span>
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
                <p className="text-sm font-semibold text-zinc-200 leading-snug">{locale === 'he' ? 'דיוק AI ומגמות ביצועים בזמן אמת' : 'AI accuracy and real-time performance trends'}</p>
              </div>
            </div>
            <div className="h-px bg-white/5" />
            <p className="text-xs text-zinc-500 leading-relaxed">
              {locale === 'he' ? 'הנתונים מסונכרנים עם מנוע הקונצנזוס והזיכרון העמוק. השתמש בלוח הביצועים לפרטים מלאים.' : 'Data is synced with the consensus engine and deep memory layer. Use the performance board for full details.'}
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
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{locale === 'he' ? 'ניתוח קריפטו · קונצנזוס' : 'Crypto Analysis · Consensus'}</span>
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
