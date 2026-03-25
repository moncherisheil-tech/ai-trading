'use client';

import { motion } from 'motion/react';
import { useMemo } from 'react';
import { GitMerge, Zap } from 'lucide-react';

export type NeuralConsensusInput = {
  debate_resolution: string | null;
  tech_score: number | null;
  risk_score: number | null;
  psych_score: number | null;
  macro_score: number | null;
  onchain_score: number | null;
  deep_memory_score: number | null;
  final_confidence: number | null;
  predicted_direction: string | null;
};

function avg(a: (number | null)[]): number | null {
  const nums = a.filter((x): x is number => x != null && Number.isFinite(x));
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export default function NeuralConsensusVisualizer({ data }: { data: NeuralConsensusInput | null }) {
  const polarized = useMemo(() => {
    if (!data) return false;
    if (data.debate_resolution && data.debate_resolution.length > 8) return true;
    const t = data.tech_score;
    const r = data.risk_score;
    if (t != null && r != null && Math.abs(t - r) >= 26) return true;
    return false;
  }, [data]);

  const momentum = avg([data?.tech_score ?? null, data?.psych_score ?? null, data?.macro_score ?? null]);
  const defense = avg([data?.risk_score ?? null, data?.onchain_score ?? null, data?.deep_memory_score ?? null]);

  const stress01 = useMemo(() => {
    if (momentum == null || defense == null) return 0.5;
    const raw = (momentum - defense) / 100;
    return Math.min(1, Math.max(0, 0.5 + raw * 0.55));
  }, [momentum, defense]);

  const winner =
    momentum != null && defense != null
      ? momentum >= defense
        ? 'ALPHA'
        : 'DEFENSE'
      : 'SYNC';

  if (!data) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/50 p-4 min-h-[140px] flex items-center justify-center">
        <p className="text-xs text-zinc-500 font-mono tabular-nums tracking-tight">NO_TELEMETRY · AWAITING_OVERSEER_STREAM</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-b from-black/60 to-black/30 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-white/10 bg-black/30">
        <div className="flex items-center gap-2 text-cyan-300/90">
          <GitMerge className="w-4 h-4 shrink-0" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em]">Neural Consensus</span>
        </div>
        <span
          className={`text-[10px] font-mono uppercase tracking-tight tabular-nums px-2 py-0.5 rounded border ${
            polarized ? 'border-amber-400/50 text-amber-300 bg-amber-500/10' : 'border-emerald-500/40 text-emerald-300/90 bg-emerald-500/10'
          }`}
        >
          {polarized ? 'POLARIZED' : 'ALIGNED'}
        </span>
      </div>

      <div className="p-4 space-y-4">
        <div className="relative h-28 w-full">
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 100" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="nc-left" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(34,211,238,0.05)" />
                <stop offset="100%" stopColor="rgba(34,211,238,0.85)" />
              </linearGradient>
              <linearGradient id="nc-right" x1="100%" y1="0%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="rgba(248,113,113,0.05)" />
                <stop offset="100%" stopColor="rgba(248,113,113,0.9)" />
              </linearGradient>
              <filter id="nc-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {polarized ? (
              <>
                <motion.path
                  d="M 0 85 Q 80 20 160 18 Q 240 20 320 85"
                  fill="none"
                  stroke="url(#nc-left)"
                  strokeWidth="2.5"
                  filter="url(#nc-glow)"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 1.1, ease: 'easeOut' }}
                />
                <motion.path
                  d="M 320 85 Q 240 20 160 18 Q 80 20 0 85"
                  fill="none"
                  stroke="url(#nc-right)"
                  strokeWidth="2.5"
                  filter="url(#nc-glow)"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 1.1, ease: 'easeOut', delay: 0.12 }}
                />
              </>
            ) : (
              <motion.path
                d="M 20 72 Q 160 12 300 72"
                fill="none"
                stroke="rgba(52,211,153,0.75)"
                strokeWidth="2"
                filter="url(#nc-glow)"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9 }}
              />
            )}
          </svg>
          <div className="absolute bottom-0 left-0 right-0 h-9 flex items-end">
            <div className="relative w-full h-2 rounded-full bg-zinc-900/90 border border-white/10 overflow-hidden">
              <motion.div
                className="absolute top-0 bottom-0 w-1 rounded-full bg-gradient-to-b from-white to-zinc-400 shadow-[0_0_14px_rgba(255,255,255,0.6)]"
                initial={false}
                style={{ position: 'absolute' }}
                animate={{ left: `${stress01 * 100}%`, x: '-50%' }}
                transition={{ type: 'spring', stiffness: 140, damping: 24 }}
              />
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500/35 to-transparent"
                style={{ width: `${stress01 * 100}%` }}
              />
              <div
                className="absolute inset-y-0 right-0 bg-gradient-to-l from-rose-500/35 to-transparent"
                style={{ width: `${(1 - stress01) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums tracking-tight">
          <span className="text-cyan-300/90 flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" aria-hidden />
            {winner === 'ALPHA' ? 'Stress → Alpha lane' : winner === 'DEFENSE' ? 'Stress → Risk shell' : 'Equilibrium'}
          </span>
          <span className="text-zinc-500">
            {data.predicted_direction ? String(data.predicted_direction) : '—'} ·{' '}
            {data.final_confidence != null ? data.final_confidence.toFixed(1) : '—'} conf
          </span>
        </div>

        {polarized && data.debate_resolution ? (
          <p className="text-xs text-zinc-300 leading-relaxed border-t border-white/5 pt-3 line-clamp-4">{data.debate_resolution}</p>
        ) : (
          <p className="text-xs text-zinc-500 border-t border-white/5 pt-3">
            Board alignment: expert lanes within tolerance. Debate trace activates when camps diverge (Overseer debate_resolution or tech/risk spread).
          </p>
        )}
      </div>
    </div>
  );
}
