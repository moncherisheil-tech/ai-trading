'use client';

/**
 * QUANTUM MON CHERI — Control Room
 * Public infrastructure health dashboard. No authentication required.
 * Auto-refreshes every 10 seconds.
 *
 * WS1 (PostgreSQL) → 178.104.75.47:5432
 * WS2 (Redis)      → 88.99.208.99:6379
 */

import { useState, useEffect, useCallback } from 'react';
import { getSystemHealth, type SystemHealth } from '@/app/actions/diagnostics';

const WS1_IP = '178.104.75.47';
const WS2_IP = '88.99.208.99';
const REFRESH_INTERVAL_MS = 10_000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface ServiceCardProps {
  label: string;
  sublabel: string;
  ip: string;
  port: string;
  role: string;
  status: 'ONLINE' | 'OFFLINE' | 'LOADING';
  latency: number | null;
  error?: string;
}

function ServiceCard({ label, sublabel, ip, port, role, status, latency, error }: ServiceCardProps) {
  const isOnline  = status === 'ONLINE';
  const isLoading = status === 'LOADING';

  return (
    <div
      className={`
        relative overflow-hidden rounded-2xl border p-6 flex flex-col gap-4
        transition-all duration-500
        ${isLoading  ? 'border-zinc-700 bg-zinc-900/60' :
          isOnline   ? 'border-emerald-500/40 bg-emerald-950/10' :
                       'border-red-500/40 bg-red-950/10'}
      `}
    >
      {/* Glow strip */}
      <div
        className={`
          absolute top-0 left-0 right-0 h-px
          ${isLoading  ? 'bg-zinc-700' :
            isOnline   ? 'bg-emerald-400/60' :
                         'bg-red-500/60'}
        `}
      />

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-mono text-zinc-500 tracking-widest uppercase mb-1">{role}</p>
          <h2 className="text-lg font-bold text-zinc-100">{label}</h2>
          <p className="text-xs text-zinc-500">{sublabel}</p>
        </div>

        {/* Status pill */}
        <div
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide shrink-0
            ${isLoading  ? 'bg-zinc-800 text-zinc-400' :
              isOnline   ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40' :
                           'bg-red-500/15 text-red-300 ring-1 ring-red-500/40'}
          `}
        >
          {isLoading ? (
            <span className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
          ) : isOnline ? (
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.6)]" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-red-400 shadow-[0_0_6px_2px_rgba(248,113,113,0.6)]" />
          )}
          {isLoading ? 'CHECKING' : status}
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-zinc-800/60 px-4 py-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Latency</p>
          <p className={`text-2xl font-bold font-mono ${
            isLoading ? 'text-zinc-600' :
            isOnline  ? (latency !== null && latency < 100 ? 'text-emerald-300' : latency !== null && latency < 500 ? 'text-amber-300' : 'text-orange-400') :
                        'text-red-400'
          }`}>
            {isLoading ? '—' : formatLatency(latency)}
          </p>
        </div>
        <div className="rounded-xl bg-zinc-800/60 px-4 py-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Host</p>
          <p className="text-sm font-mono text-zinc-200 break-all">{ip}</p>
          <p className="text-[10px] text-zinc-500 font-mono">:{port}</p>
        </div>
      </div>

      {/* Error message */}
      {!isLoading && !isOnline && error && (
        <div className="rounded-lg bg-red-950/30 border border-red-500/20 px-3 py-2">
          <p className="text-xs text-red-400 font-mono break-all">{error}</p>
        </div>
      )}
    </div>
  );
}

// ── Countdown ring ────────────────────────────────────────────────────────────

function CountdownBar({ progress }: { progress: number }) {
  return (
    <div className="w-full h-0.5 rounded-full bg-zinc-800 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-none"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ControlRoomPage() {
  const [health, setHealth]       = useState<SystemHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(1);

  const fetchHealth = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getSystemHealth();
      setHealth(data);
      setLastFetch(new Date());
    } catch (err) {
      console.error('[ControlRoom] Failed to fetch system health:', err);
    } finally {
      setIsLoading(false);
      setCountdown(1);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // Tick the countdown bar down toward 0
  useEffect(() => {
    if (isLoading) return;
    const tick = 100;
    const step = tick / REFRESH_INTERVAL_MS;
    const id = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - step));
    }, tick);
    return () => clearInterval(id);
  }, [isLoading, lastFetch]);

  const dbStatus    = isLoading || !health ? 'LOADING' : health.db.status;
  const redisStatus = isLoading || !health ? 'LOADING' : health.redis.status;

  const allOnline = !isLoading && health?.db.status === 'ONLINE' && health?.redis.status === 'ONLINE';
  const anyOffline = !isLoading && (health?.db.status === 'OFFLINE' || health?.redis.status === 'OFFLINE');

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ── Scanline texture overlay ──────────────────────────────────────── */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg,transparent,transparent 1px,rgba(255,255,255,0.08) 1px,rgba(255,255,255,0.08) 2px)',
          backgroundSize: '100% 2px',
        }}
      />

      <div className="relative max-w-3xl mx-auto px-4 py-10 space-y-8">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${
              isLoading  ? 'bg-zinc-500 animate-pulse' :
              allOnline  ? 'bg-emerald-400 shadow-[0_0_8px_3px_rgba(52,211,153,0.5)]' :
              anyOffline ? 'bg-red-400 shadow-[0_0_8px_3px_rgba(248,113,113,0.5)]' :
                           'bg-amber-400'
            }`} />
            <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
              QUANTUM MON CHERI
              <span className="ml-3 text-sm font-mono font-normal text-zinc-500">// CONTROL ROOM</span>
            </h1>
          </div>
          <p className="text-xs text-zinc-600 font-mono pl-6">
            Infrastructure Sovereignty Dashboard · Auto-refresh 10s
          </p>
        </div>

        {/* ── Countdown bar ───────────────────────────────────────────────── */}
        <CountdownBar progress={countdown} />

        {/* ── Service cards ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <ServiceCard
            label="PostgreSQL"
            sublabel="Quantum Core DB — WS1"
            ip={WS1_IP}
            port="5432"
            role="Primary Database"
            status={dbStatus}
            latency={health?.db.latency ?? null}
            error={health?.db.error}
          />
          <ServiceCard
            label="Redis"
            sublabel="Whale Alert Bus — WS2"
            ip={WS2_IP}
            port="6379"
            role="Real-Time Stream"
            status={redisStatus}
            latency={health?.redis.latency ?? null}
            error={health?.redis.error}
          />
        </div>

        {/* ── System banner ───────────────────────────────────────────────── */}
        <div className={`
          rounded-2xl border px-5 py-4 flex items-center gap-4
          transition-colors duration-500
          ${isLoading   ? 'border-zinc-700 bg-zinc-900/40' :
            allOnline   ? 'border-emerald-500/30 bg-emerald-950/10' :
            anyOffline  ? 'border-red-500/30 bg-red-950/10' :
                          'border-amber-500/30 bg-amber-950/10'}
        `}>
          <div className={`text-3xl ${isLoading ? 'animate-pulse' : ''}`}>
            {isLoading ? '⏳' : allOnline ? '✅' : anyOffline ? '🔴' : '⚠️'}
          </div>
          <div>
            <p className={`font-bold text-base ${
              isLoading   ? 'text-zinc-400' :
              allOnline   ? 'text-emerald-300' :
              anyOffline  ? 'text-red-300' :
                            'text-amber-300'
            }`}>
              {isLoading   ? 'Probing infrastructure…' :
               allOnline   ? 'All systems operational' :
               anyOffline  ? 'Degraded — service(s) unreachable' :
                             'Partial outage detected'}
            </p>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">
              {health ? `Last checked at ${formatTime(health.timestamp)}` : 'Awaiting first probe…'}
            </p>
          </div>
        </div>

        {/* ── Infrastructure map ──────────────────────────────────────────── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
          <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
            Infrastructure Map
          </h3>
          <div className="space-y-2 text-sm font-mono">
            {[
              { label: 'WS1 — Berlin    ', ip: WS1_IP, port: '5432', role: 'PostgreSQL (bare-metal Ubuntu)', color: 'text-cyan-400' },
              { label: 'WS2 — Nuremberg ', ip: WS2_IP, port: '6379', role: 'Redis (bare-metal Ubuntu)',      color: 'text-violet-400' },
              { label: 'WS0 — Local     ', ip: '127.0.0.1',          port: '3000', role: 'Next.js (this process)',       color: 'text-amber-400' },
            ].map(({ label, ip, port, role, color }) => (
              <div key={ip} className="flex items-center gap-3 flex-wrap">
                <span className={`${color} shrink-0`}>{label}</span>
                <span className="text-zinc-300">{ip}<span className="text-zinc-600">:{port}</span></span>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-500">{role}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <p className="text-center text-[11px] text-zinc-700 font-mono">
          QUANTUM MON CHERI · Project Alpha · {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
