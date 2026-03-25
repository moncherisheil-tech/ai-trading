'use client';

import dynamic from 'next/dynamic';
import { useEffect, useId, useMemo, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
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
import { Skeleton } from '@/components/ui/Skeleton';
import { useLocale } from '@/hooks/use-locale';
import { getExecutionDashboardSnapshotAction, getMarketRiskSentinelAction } from '@/app/actions';
import { useMarketState } from '@/context/MarketStateContext';
import { useCyberDecryptNumber } from '@/hooks/use-cyber-decrypt-value';

const GLASS =
  'frosted-obsidian sovereign-tilt rounded-3xl';

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

const EXPERT_META = [
  { name: 'Technical Analyst', alias: 'The Engineer', neon: '#00E5FF' },
  { name: 'Fundamental Analyst', alias: 'The Professor', neon: '#A855F7' },
  { name: 'Sentiment Analyst', alias: 'The Social Lead', neon: '#EC4899' },
  { name: 'On-Chain/Whale Analyst', alias: 'The Leviathan', neon: '#06B6D4' },
  { name: 'Risk Manager', alias: 'The Shield', neon: '#22C55E' },
  { name: 'Macro Analyst', alias: 'The Strategist', neon: '#F59E0B' },
  { name: 'AI Overseer', alias: 'The Architect', neon: '#FB7185' },
] as const;

type ExpertCardData = (typeof EXPERT_META)[number] & {
  score: number | null;
  status: 'LIVE' | 'AWAITING_LIVE_DATA';
};

const CryptoAnalyzer = dynamic(() => import('@/components/CryptoAnalyzer'), {
  loading: () => (
    <div className="w-full min-w-0 p-6 space-y-4" dir="rtl" aria-live="polite">
      <div className="cyber-decrypt text-xs font-semibold tracking-[0.3em]" data-scramble="7X-NEURAL-KEY">
        INITIALIZING CONSENSUS
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

function ExpertSigil({ neon, active, gradId }: { neon: string; active: boolean; gradId: string }) {
  return (
    <svg viewBox="0 0 56 56" className="h-6 w-6" aria-hidden>
      <defs>
        <radialGradient id={gradId} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor={neon} stopOpacity="0.8" />
          <stop offset="100%" stopColor={neon} stopOpacity="0.1" />
        </radialGradient>
      </defs>
      <circle cx="28" cy="28" r="25" fill="none" stroke={neon} strokeOpacity="0.35" />
      <path d="M12 28h32M28 12v32M17 17l22 22M39 17L17 39" stroke={neon} strokeOpacity="0.7" strokeWidth="1.5" />
      <circle
        cx="28"
        cy="28"
        r="8"
        fill={`url(#${gradId})`}
        style={active ? { filter: `drop-shadow(0 0 10px ${neon})` } : undefined}
      />
    </svg>
  );
}

function ExpertTiltCard({
  expert,
  consensusPulse,
  isDefcon1,
}: {
  expert: ExpertCardData;
  consensusPulse: boolean;
  isDefcon1: boolean;
}) {
  const sigGradId = useId().replace(/:/g, '');
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rx = useSpring(useTransform(y, [-50, 50], [11, -11]), { stiffness: 220, damping: 18 });
  const ry = useSpring(useTransform(x, [-50, 50], [-11, 11]), { stiffness: 220, damping: 18 });
  const tzRaw = useTransform([x, y], ([lx, ly]) => 18 + Math.abs(lx as number) * 0.08 + Math.abs(ly as number) * 0.04);
  const tz = useSpring(tzRaw, { stiffness: 260, damping: 24 });
  const glow = useMemo(() => `${expert.neon}${expert.status === 'LIVE' ? '66' : '2a'}`, [expert.neon, expert.status]);
  const isLeviathan = expert.alias.includes('Leviathan');
  const isShield = expert.alias.includes('Shield');
  const [spotlight, setSpotlight] = useState({ x: '50%', y: '50%', opacity: 0 });
  const scoreDecrypt = useCyberDecryptNumber(expert.score, { decimals: 1 });

  const auraTone =
    isDefcon1 && isShield
      ? 'rgba(248,113,113,0.35)'
      : consensusPulse
        ? `${expert.neon}44`
        : `${expert.neon}22`;

  return (
    <div className="[perspective:1100px]">
      <motion.article
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = e.clientX - (rect.left + rect.width / 2);
          const relY = e.clientY - (rect.top + rect.height / 2);
          x.set(relX);
          y.set(relY);
          setSpotlight({
            x: `${((e.clientX - rect.left) / rect.width) * 100}%`,
            y: `${((e.clientY - rect.top) / rect.height) * 100}%`,
            opacity: 1,
          });
        }}
        onMouseLeave={() => {
          x.set(0);
          y.set(0);
          setSpotlight((prev) => ({ ...prev, opacity: 0 }));
        }}
        style={{
          rotateX: rx,
          rotateY: ry,
          transformStyle: 'preserve-3d',
          background: `radial-gradient(120% 110% at 50% 0%, ${expert.neon}22 0%, rgba(255,255,255,0.02) 58%)`,
          boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.06), 0 22px 40px rgba(0,0,0,0.5), 0 0 32px ${glow}`,
          ['--spotlight-x' as string]: spotlight.x,
          ['--spotlight-y' as string]: spotlight.y,
          ['--spotlight-opacity' as string]: spotlight.opacity,
        }}
        className="spotlight-card frosted-obsidian sovereign-tilt z-depth-2 relative rounded-2xl p-4 overflow-hidden transition-transform duration-200"
      >
        {isLeviathan ? <div className="leviathan-wave" aria-hidden /> : null}
        <div
          className="absolute -inset-20 opacity-30 motion-safe:animate-pulse motion-reduce:animate-none"
          style={{
            background: `radial-gradient(circle, ${auraTone}, transparent 62%)`,
            animationDuration: consensusPulse ? '2.8s' : '4.2s',
          }}
        />
        <div className="absolute inset-0 opacity-40" style={{ background: `radial-gradient(circle at 50% 90%, ${expert.neon}1f, transparent 70%)` }} />
        <motion.div className="relative flex items-center justify-between" style={{ translateZ: tz }}>
          <div className="h-10 w-10 rounded-xl border border-white/10 bg-black/45 flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <ExpertSigil neon={expert.neon} active={consensusPulse} gradId={sigGradId} />
          </div>
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: expert.neon, boxShadow: `0 0 12px ${expert.neon}` }} />
        </motion.div>
        <motion.p className="relative mt-3 text-sm text-zinc-100 font-semibold leading-tight tracking-tight" style={{ translateZ: 26 }}>
          {expert.name}
        </motion.p>
        <p className="relative text-[11px] uppercase tracking-wider text-zinc-300/90 mt-1" style={{ transform: 'translateZ(22px)' }}>
          {expert.alias}
        </p>
        <p className="relative mt-2 text-[11px] text-zinc-300/90 font-mono tabular-nums tracking-tight" style={{ transform: 'translateZ(20px)' }}>
          {expert.score != null ? `Score ${scoreDecrypt}` : 'Score AWAITING_LIVE_DATA'}
        </p>
        <p
          className={`relative text-[10px] uppercase tracking-[0.16em] font-mono tabular-nums ${expert.status === 'LIVE' ? 'text-emerald-300' : 'text-amber-300'}`}
          style={{ transform: 'translateZ(16px)' }}
        >
          {expert.status}
        </p>
      </motion.article>
    </div>
  );
}

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
  const { isDefcon1, defcon, sentiment, volatilityNormalized } = useMarketState();
  const [consensusPulse, setConsensusPulse] = useState(false);
  const [marketMode, setMarketMode] = useState<MarketMode>('bull');
  const [experts, setExperts] = useState<ExpertCardData[]>(
    EXPERT_META.map((expert) => ({ ...expert, score: null, status: 'AWAITING_LIVE_DATA' }))
  );

  useEffect(() => {
    let mounted = true;
    type ExecutionSnapshot = {
      minConfidenceToExecute?: number;
      recentExecutions?: Array<{
        confidence?: number;
        expertBreakdown?: {
          technician?: { score?: number };
          deepMemory?: { score?: number };
          marketPsychologist?: { score?: number };
          onChainSleuth?: { score?: number };
          riskManager?: { score?: number };
          macroOrderBook?: { score?: number };
        } | null;
      }>;
    };
    const toScore = (value: unknown): number | null => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const syncExecutionState = async () => {
      try {
        const payload = (await getExecutionDashboardSnapshotAction()) as ExecutionSnapshot;
        if (!mounted || !payload) return;
        const latest = payload.recentExecutions?.[0];
        const breakdown = latest?.expertBreakdown ?? null;
        const mappedScores: Array<number | null> = [
          toScore(breakdown?.technician?.score),
          toScore(breakdown?.deepMemory?.score),
          toScore(breakdown?.marketPsychologist?.score),
          toScore(breakdown?.onChainSleuth?.score),
          toScore(breakdown?.riskManager?.score),
          toScore(breakdown?.macroOrderBook?.score),
          toScore(latest?.confidence),
        ];
        const nextExperts = EXPERT_META.map((meta, idx) => {
          const score = mappedScores[idx] ?? null;
          const status: ExpertCardData['status'] = score == null ? 'AWAITING_LIVE_DATA' : 'LIVE';
          return { ...meta, score, status };
        });
        setExperts(nextExperts);
        const threshold = typeof payload.minConfidenceToExecute === 'number' ? payload.minConfidenceToExecute : 75;
        const latestConfidence = toScore(latest?.confidence);
        setConsensusPulse(latestConfidence != null && latestConfidence >= threshold);
      } catch {
        if (!mounted) return;
        setConsensusPulse(false);
        setExperts(
          EXPERT_META.map((expert) => ({ ...expert, score: null, status: 'AWAITING_LIVE_DATA' as const }))
        );
      }
    };
    void syncExecutionState();
    const timer = setInterval(syncExecutionState, 12000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const syncMarketMode = async () => {
      try {
        const payload = (await getMarketRiskSentinelAction()) as { status?: 'SAFE' | 'DANGEROUS' };
        setMarketMode(payload.status === 'DANGEROUS' ? 'bear' : 'bull');
      } catch {
        if (mounted) setMarketMode('bull');
      }
    };
    void syncMarketMode();
    const timer = setInterval(syncMarketMode, 20000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section
      data-defcon={defcon}
      data-defcon1={isDefcon1 ? '1' : '0'}
      className={`relative z-[2] min-h-screen bg-transparent text-zinc-100 overflow-x-hidden transition-colors duration-500 ${
        marketMode === 'bull' ? 'market-mode-bull' : 'market-mode-bear'
      } ${isDefcon1 ? 'defcon-terminal' : ''}`}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="pointer-events-none absolute inset-0 council-vignette" aria-hidden />

      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        variants={staggerContainer}
        className="relative max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10 w-full min-w-0"
      >
        {/* Command strip */}
        <motion.header variants={staggerItem} className={`${GLASS} z-depth-3 mb-6 px-5 py-4 sm:px-6 flex flex-wrap items-center justify-between gap-4`}>
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15 border border-cyan-500/30 shadow-[0_0_24px_rgba(6,182,212,0.2)]">
              <Activity className="h-5 w-5 text-cyan-300" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-300/85">AI Council Terminal</p>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate">{locale === 'he' ? 'Sovereign Terminal' : 'Sovereign Terminal'}</h1>
              <p className="text-xs text-zinc-500 mt-0.5 hidden sm:block">{locale === 'he' ? 'סימולציה ולימוד בלבד · לא ייעוץ השקעות' : 'Simulation and learning only · not investment advice'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <span className={`text-[10px] uppercase tracking-[0.24em] px-3 py-1 rounded-full border live-data-number tabular-nums tracking-tight ${marketMode === 'bull' ? 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10' : 'text-rose-300 border-rose-400/40 bg-rose-500/10'}`}>
              {marketMode === 'bull' ? 'Bull Mode' : 'Bear Mode'}
            </span>
            <span
              className={`text-[10px] uppercase tracking-[0.24em] px-3 py-1 rounded-full border font-mono tabular-nums tracking-tight ${
                isDefcon1
                  ? 'text-rose-200 border-rose-500/60 bg-rose-950/50 ring-1 ring-rose-500/30'
                  : defcon === 2
                    ? 'text-amber-200 border-amber-500/40 bg-amber-950/30'
                    : 'text-cyan-200/80 border-cyan-500/30 bg-cyan-950/20'
              }`}
              title={sentiment?.reasoning ?? ''}
            >
              DEFCON {defcon}
              {volatilityNormalized > 0.55 ? ' · HI-VOL' : ''}
            </span>
            <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
              <Cpu className="h-3.5 w-3.5 text-cyan-500/70" />
              <span>Consensus · Deep Memory</span>
            </div>
            <TerminalClock />
          </div>
        </motion.header>

        <motion.div variants={staggerItem} className="mb-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-[11px] uppercase tracking-[0.3em] text-cyan-300/90">The 7 Experts</p>
            <p className={`text-xs ${consensusPulse ? 'text-emerald-300' : 'text-zinc-500'}`}>
              {consensusPulse ? 'Consensus Reached' : 'Awaiting Consensus'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-3">
            {experts.map((expert) => {
              return (
                <ExpertTiltCard key={expert.name} expert={expert} consensusPulse={consensusPulse} isDefcon1={isDefcon1} />
              );
            })}
          </div>
        </motion.div>

        <motion.div variants={staggerItem} className="grid grid-cols-1 lg:grid-cols-12 auto-rows-[minmax(160px,auto)] gap-x-5 gap-y-7 lg:gap-x-7 lg:gap-y-8">
          {/* Deep Memory — prominent */}
          <DeepMemoryFeed
            className={`lg:col-span-4 xl:col-span-3 min-h-[320px] lg:min-h-[380px] lg:row-span-2 transition-[opacity,filter] duration-500 ${
              isDefcon1 ? 'opacity-[0.18] pointer-events-none saturate-50 blur-[0.5px] lg:max-h-[120px] overflow-hidden' : ''
            }`}
          />

          <div
            className={`${GLASS} neural-pulse-border sovereign-tilt z-depth-3 overflow-hidden flex flex-col lg:col-span-4 xl:col-span-6 lg:row-span-2 shadow-[0_35px_80px_rgba(0,0,0,0.6)] transition-transform duration-500 ${
              isDefcon1 ? 'lg:scale-[1.01] ring-1 ring-rose-500/25' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/10 bg-black/20">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-5 w-5 text-cyan-300" />
                <span className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-100/90">{locale === 'he' ? 'ליבת Overseer' : 'AI Overseer Hub'}</span>
              </div>
              <span className={`text-[11px] uppercase tracking-[0.18em] live-data-number ${consensusPulse ? 'text-emerald-300' : 'text-zinc-400'}`}>
                {consensusPulse ? 'NEURAL SYNCED' : 'NEURAL SCANNING'}
              </span>
            </div>
            <div className="flex-1 p-4 sm:p-5">
              <CryptoAnalyzer />
            </div>
          </div>

          {/* Market pulse stack */}
          <div
            className={`${GLASS} sovereign-tilt z-depth-2 overflow-hidden flex flex-col lg:col-span-4 xl:col-span-3 transition-transform duration-500 ${
              isDefcon1 ? 'lg:scale-[1.01] ring-1 ring-rose-500/30 order-first lg:order-none' : ''
            }`}
          >
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
          <div
            className={`${GLASS} sovereign-tilt z-depth-1 p-5 flex flex-col justify-center gap-4 lg:col-span-4 xl:col-span-3 transition-[opacity,filter] duration-500 ${
              isDefcon1 ? 'opacity-[0.2] pointer-events-none saturate-50' : ''
            }`}
          >
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
          <div className={`lg:col-span-8 xl:col-span-9 min-w-0 transition-transform duration-500 ${isDefcon1 ? 'lg:scale-[1.005]' : ''}`}>
            <PaperTradingPanel />
          </div>

          {/* AI accuracy */}
          <div
            className={`${GLASS} sovereign-tilt z-depth-2 p-5 sm:p-6 lg:col-span-4 xl:col-span-3 transition-[opacity,filter] duration-500 ${
              isDefcon1 ? 'opacity-[0.2] pointer-events-none saturate-50' : ''
            }`}
          >
            <AIAccuracyChart />
          </div>

          <div
            className={`${GLASS} sovereign-tilt z-depth-2 overflow-hidden lg:col-span-8 xl:col-span-9 transition-[opacity,filter] duration-500 ${
              isDefcon1 ? 'opacity-[0.22] pointer-events-none saturate-50' : ''
            }`}
          >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-black/20">
              <Cpu className="h-4 w-4 text-amber-400/90" />
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{locale === 'he' ? 'מנוע ביצועים' : 'Performance Intelligence Stream'}</span>
            </div>
            <div className="p-4 sm:p-6 overflow-x-hidden">
              <div className="cyber-decrypt text-xs tracking-[0.24em] font-semibold mb-4" data-scramble="DATA-LINK-SECURE">
                LIVE TELEMETRY READY
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">
                {locale === 'he' ? 'זרם הנתונים מבוסס על 7 מומחי AI, מנוע קונצנזוס וזיכרון עמוק. כל המדדים מתעדכנים באופן רציף.' : 'Telemetry is fused from the 7 AI experts, consensus engine, and deep memory layer with continuous refresh.'}
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
