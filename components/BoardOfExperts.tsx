'use client';

import { useId, useMemo } from 'react';
import { motion, type Variants } from 'motion/react';
import { useMarketState } from '@/context/MarketStateContext';
import { useCyberDecryptNumber } from '@/hooks/use-cyber-decrypt-value';
import { useAIStatus } from '@/hooks/use-ai-status';
import { useLiveExecutionStream } from '@/context/LiveExecutionStreamContext';

const EXPERT_META = [
  { name: 'אנליסט טכני', alias: 'מהנדס השוק', neon: '#00E5FF' },
  { name: 'אנליסט פונדמנטלי', alias: 'פרופסור הנתונים', neon: '#A855F7' },
  { name: 'אנליסט סנטימנט', alias: 'מוביל תחושת השוק', neon: '#EC4899' },
  { name: 'אנליסט אונ־צ׳יין / לווייתנים', alias: 'לווייתן', neon: '#06B6D4' },
  { name: 'מנהל סיכונים', alias: 'המגן', neon: '#22C55E' },
  { name: 'אנליסט מאקרו', alias: 'אסטרטג המאקרו', neon: '#F59E0B' },
  { name: 'מפקח AI', alias: 'האדריכל', neon: '#FB7185' },
] as const;

export type ExpertAgentStatus =
  | 'פעיל'
  | 'פעיל (סריקה)'
  | 'ממתין לנתוני שוק'
  | 'לא זמין — ניסיון חוזר';

type ExpertCardData = (typeof EXPERT_META)[number] & {
  score: number | null;
  status: ExpertAgentStatus;
};

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

function statusTone(status: ExpertAgentStatus): string {
  if (status === 'פעיל') return 'text-emerald-300';
  if (status === 'פעיל (סריקה)') return 'text-cyan-300';
  if (status.startsWith('לא זמין')) return 'text-amber-400';
  return 'text-amber-300';
}

function ExpertCard({
  expert,
  consensusPulse,
  isDefcon1,
}: {
  expert: ExpertCardData;
  consensusPulse: boolean;
  isDefcon1: boolean;
}) {
  const sigGradId = useId().replace(/:/g, '');
  const isLeviathan = expert.alias.includes('לווייתן');
  const isShield = expert.alias.includes('מגן');
  const scoreDecrypt = useCyberDecryptNumber(expert.score, { decimals: 1 });

  const auraTone =
    isDefcon1 && isShield
      ? 'rgba(248,113,113,0.35)'
      : consensusPulse
        ? `${expert.neon}44`
        : `${expert.neon}22`;

  return (
    <div>
      <motion.article
        style={{
          background: `radial-gradient(120% 110% at 50% 0%, ${expert.neon}22 0%, rgba(255,255,255,0.02) 58%)`,
          boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.06)`,
          borderColor: `${expert.neon}33`,
        }}
        className="spotlight-card frosted-obsidian panel-sovereign-diamond z-depth-2 relative z-0 rounded-2xl p-4 overflow-hidden transition-colors duration-200 backdrop-blur-[60px] border border-white/10 hover:border-cyan-300/70"
      >
        {isLeviathan ? <div className="leviathan-wave" aria-hidden /> : null}
        <div
          className="absolute -inset-20 opacity-30 motion-safe:animate-pulse motion-reduce:animate-none pointer-events-none"
          style={{
            background: `radial-gradient(circle, ${auraTone}, transparent 62%)`,
            animationDuration: consensusPulse ? '2.8s' : '4.2s',
          }}
        />
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 90%, ${expert.neon}1f, transparent 70%)` }}
        />
        <motion.div className="relative z-[1] flex items-center justify-between">
          <div className="h-10 w-10 rounded-xl border border-white/10 bg-black/45 flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <ExpertSigil neon={expert.neon} active={consensusPulse} gradId={sigGradId} />
          </div>
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: expert.neon, boxShadow: `0 0 12px ${expert.neon}` }} />
        </motion.div>
        <motion.p className="relative z-[1] mt-3 text-sm text-zinc-100 font-semibold leading-tight tracking-tight">
          {expert.name}
        </motion.p>
        <p className="relative z-[1] text-[11px] uppercase tracking-wider text-zinc-300/90 mt-1">
          {expert.alias}
        </p>
        <p className="relative z-[1] mt-2 text-[11px] text-zinc-300/90 font-mono tabular-nums tracking-tight">
          {expert.score != null ? `ניקוד ${scoreDecrypt}` : 'ניקוד — ממתין לנתוני שוק'}
        </p>
        <p className={`relative z-[1] text-[10px] uppercase tracking-[0.16em] font-mono tabular-nums ${statusTone(expert.status)}`}>
          {expert.status}
        </p>
      </motion.article>
    </div>
  );
}

function mergeExpertStatus(
  score: number | null,
  aiLoading: boolean,
  ai: ReturnType<typeof useAIStatus>['status']
): ExpertAgentStatus {
  if (score != null) return 'פעיל';
  const providerReady = Boolean(ai?.gemini || ai?.anthropic || ai?.grok);
  if (ai?.dbConnected && providerReady) return 'פעיל';
  if (aiLoading && !ai) return 'ממתין לנתוני שוק';
  if (ai?.anyProviderOk) return 'פעיל (סריקה)';
  if (ai?.error || (ai && !ai.anyProviderOk)) return 'לא זמין — ניסיון חוזר';
  return 'ממתין לנתוני שוק';
}

type BoardOfExpertsProps = {
  staggerItem: Variants;
};

/**
 * MoE / consensus expert grid with execution snapshot + AI provider heartbeat (via `useAIStatus`).
 */
export default function BoardOfExperts({ staggerItem }: BoardOfExpertsProps) {
  const { isDefcon1 } = useMarketState();
  const { status: aiStatus, loading: aiLoading } = useAIStatus();

  // ── SSE stream replaces the 12-second polling interval ───────────────────
  const { snap } = useLiveExecutionStream();

  const toScore = (value: unknown): number | null => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const { scores, consensusPulse } = useMemo(() => {
    if (!snap) {
      return { scores: EXPERT_META.map(() => null) as (number | null)[], consensusPulse: false };
    }
    const latest = snap.recentExecutions?.[0];
    const breakdown = (latest?.expertBreakdown ?? null) as Record<string, { score?: unknown }> | null;
    const mappedScores: (number | null)[] = [
      toScore(breakdown?.technician?.score),
      toScore(breakdown?.deepMemory?.score),
      toScore(breakdown?.marketPsychologist?.score),
      toScore(breakdown?.onChainSleuth?.score),
      toScore(breakdown?.riskManager?.score),
      toScore(breakdown?.macroOrderBook?.score),
      toScore(latest?.confidence),
    ];
    const threshold = typeof snap.minConfidenceToExecute === 'number' ? snap.minConfidenceToExecute : 75;
    const latestConf = toScore(latest?.confidence);
    return {
      scores: mappedScores,
      consensusPulse: latestConf != null && latestConf >= threshold,
    };
  }, [snap]);

  const experts: ExpertCardData[] = useMemo(
    () =>
      EXPERT_META.map((meta, idx) => ({
        ...meta,
        score: scores[idx] ?? null,
        status: mergeExpertStatus(scores[idx] ?? null, aiLoading, aiStatus),
      })),
    [scores, aiLoading, aiStatus]
  );

  return (
    <motion.div variants={staggerItem} className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[11px] uppercase tracking-[0.3em] text-cyan-300/90">שבעת המומחים</p>
        <div className="flex flex-col items-end gap-0.5">
          <p className={`text-xs ${consensusPulse ? 'text-emerald-300' : 'text-zinc-500'}`}>
            {consensusPulse ? 'הושג קונצנזוס' : 'ממתין לקונצנזוס'}
          </p>
          {aiStatus && !aiStatus.adminSecretConfigured ? (
            <p className="text-[10px] text-amber-500/90 tabular-nums">ADMIN_SECRET לא מוגדר בשרת — חלק מפעולות האופס מוגבלות</p>
          ) : null}
          {aiStatus ? (
            <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                i9 Pipeline Active
              </span>
              <span className={`inline-flex items-center gap-1 ${aiStatus.dbConnected ? 'text-emerald-300' : 'text-zinc-500'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${aiStatus.dbConnected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                DB {aiStatus.dbConnected ? 'Connected' : 'Offline'}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-3">
        {experts.map((expert) => (
          <ExpertCard key={expert.name} expert={expert} consensusPulse={consensusPulse} isDefcon1={isDefcon1} />
        ))}
      </div>
    </motion.div>
  );
}
