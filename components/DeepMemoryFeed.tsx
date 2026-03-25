'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Radio } from 'lucide-react';

type ExecutionRow = {
  symbol: string;
  status: string;
  confidence: number;
  mode: string;
  createdAt: string;
  overseerSummary: string | null;
  overseerReasoningPath: string | null;
};

type ExecutionStatusPayload = {
  recentExecutions?: ExecutionRow[];
};

function formatLiveLine(row: ExecutionRow): string {
  const ts = new Date(row.createdAt).toLocaleTimeString('en-GB', { hour12: false });
  const summary = (row.overseerSummary ?? row.overseerReasoningPath ?? 'Execution recorded').slice(0, 96);
  return `[${ts}] [Deep Memory] ${row.symbol}: ${row.status.toUpperCase()} · ${row.mode} · conf ${row.confidence.toFixed(1)} — ${summary}`;
}

export type DeepMemoryFeedProps = {
  className?: string;
};

export default function DeepMemoryFeed({ className = '' }: DeepMemoryFeedProps) {
  const [lines, setLines] = useState<string[]>([
    '[Deep Memory] Loading live execution memory feed...',
  ]);
  const [live, setLive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const seenKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
        const res = await fetch(`${baseUrl}/api/trading/execution/status`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as ExecutionStatusPayload;
        const rows = Array.isArray(payload.recentExecutions) ? payload.recentExecutions : [];
        if (!mounted) return;
        if (rows.length === 0) {
          setLive(false);
          setLines(['[Deep Memory] No execution memory events yet.']);
          return;
        }

        const nextLines: string[] = [];
        for (const row of rows.slice(0, 20).reverse()) {
          const key = `${row.symbol}|${row.createdAt}|${row.status}|${row.confidence}`;
          if (!seenKeysRef.current.has(key)) {
            seenKeysRef.current.add(key);
            nextLines.push(formatLiveLine(row));
          }
        }

        setLive(true);
        if (nextLines.length > 0) {
          setLines((prev) => [...prev, ...nextLines].slice(-120));
        }
      } catch {
        if (!mounted) return;
        setLive(false);
        setLines((prev) => (prev.length > 0 ? prev : ['[Deep Memory] Feed unavailable.']));
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 8000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const statusLabel = useMemo(() => (live ? 'Live' : 'Standby'), [live]);

  useEffect(() => {
    // Keeps stream anchored to newest records unless user scrolls up.
    const el = scrollRef.current;
    if (!el || !stickBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (!live) {
      seenKeysRef.current.clear();
    }
  }, [live]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottom.current = dist < 48;
  };

  return (
    <div
      className={`flex flex-col min-h-[280px] bg-zinc-900/60 backdrop-blur-xl border border-white/5 rounded-3xl shadow-2xl overflow-hidden ${className}`}
      dir="ltr"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/5 bg-black/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 border border-violet-400/20 shadow-[0_0_20px_rgba(139,92,246,0.25)]">
            <BrainCircuit className="h-4 w-4 text-violet-300" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-violet-400/90">Deep Memory</div>
            <div className="text-sm font-semibold text-zinc-100 truncate">Pinecone · Learning stream</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.2)]">
          <Radio className="h-3 w-3 text-emerald-400 animate-pulse" aria-hidden />
          {statusLabel}
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-[220px] max-h-[420px] overflow-y-auto overflow-x-hidden px-4 py-3 font-mono text-[11px] sm:text-xs leading-relaxed bg-black/35 scroll-smooth"
        style={{ scrollbarGutter: 'stable' }}
      >
        {lines.map((line, i) => {
          const split = line.split('[Deep Memory]');
          const pre = split[0] ?? '';
          const post = split.length > 1 ? split.slice(1).join('[Deep Memory]') : line;
          return (
            <div
              key={`${i}-${line.slice(0, 32)}`}
              className="border-b border-white/[0.04] py-1.5 text-left break-words"
            >
              {pre ? <span className="text-zinc-500">{pre}</span> : null}
              <span className="text-violet-400">[Deep Memory]</span>
              <span className="text-emerald-200/85">{post}</span>
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2 border-t border-white/5 bg-black/25 text-[10px] font-mono text-zinc-500 text-center">
        Execution-backed stream from autonomous engine memory
      </div>
    </div>
  );
}
