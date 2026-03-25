'use client';

import { useState, useEffect, useCallback } from 'react';
import { Activity, Clock, Gem } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useRefreshIntervalMs } from '@/context/AppSettingsContext';

type ScannerControlPanelProps = {
  initialData: {
    lastScanTime: string | null;
    gemsFoundToday: number;
    status: 'ACTIVE' | 'IDLE';
    lastRunStats: { coinsChecked: number; gemsFound: number; alertsSent: number } | null;
    scanner_is_active: boolean;
  };
};

type ScannerDiagnostics = {
  coinsChecked: number;
  analysisFailed: number;
  belowThreshold: number;
  alreadyAlerted: number;
  gemsFound: number;
  alertsSent: number;
  summaryWhenZeroGems: string | null;
};

type ApiState = {
  scanner_is_active: boolean;
  last_scan_time_iso: string | null;
  gems_found_today: number;
  last_run_stats: { coinsChecked: number; gemsFound: number; alertsSent: number } | null;
  last_diagnostics: ScannerDiagnostics | null;
};

const EMPTY_SCAN_LABEL = 'טרם בוצעה סריקה';

function formatRelativeTime(iso: string | null): string {
  if (!iso) return EMPTY_SCAN_LABEL;
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMins < 1) return 'עכשיו';
  if (diffMins < 60) return `לפני ${diffMins} דקות`;
  if (diffHours < 24) return `לפני ${diffHours} שעות`;
  if (diffDays < 2) return 'אתמול';
  return d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ScannerControlPanel({ initialData }: ScannerControlPanelProps) {
  const toast = useToast();
  const refreshIntervalMs = useRefreshIntervalMs();
  const [active, setActive] = useState(initialData.scanner_is_active);
  const [lastScanIso, setLastScanIso] = useState<string | null>(initialData.lastScanTime);
  const [gemsToday, setGemsToday] = useState(initialData.gemsFoundToday);
  const [lastRunStats, setLastRunStats] = useState(initialData.lastRunStats);
  const [lastDiagnostics, setLastDiagnostics] = useState<ScannerDiagnostics | null>(null);
  const [toggling, setToggling] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/scanner', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as ApiState;
      setActive(data.scanner_is_active);
      setLastScanIso(data.last_scan_time_iso);
      setGemsToday(data.gems_found_today);
      setLastRunStats(data.last_run_stats);
      setLastDiagnostics(data.last_diagnostics ?? null);
    } catch {
      // keep current state
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    fetchState();
    const t = setInterval(fetchState, refreshIntervalMs);
    return () => clearInterval(t);
  }, [mounted, fetchState, refreshIntervalMs]);

  useEffect(() => {
    if (!mounted) return;
    const t = setInterval(() => setTick((n) => n + 1), refreshIntervalMs);
    return () => clearInterval(t);
  }, [mounted, refreshIntervalMs]);

  const handleToggle = async () => {
    setToggling(true);
    try {
      const res = await fetch('/api/settings/scanner', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanner_is_active: !active }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setActive(Boolean(json.scanner_is_active));
        toast.success(json.scanner_is_active ? 'סורק השוק הופעל.' : 'סורק השוק כובה.');
      } else {
        toast.error(json?.error ?? 'לא ניתן לעדכן את הסורק. נסה שוב.');
      }
    } catch {
      toast.error('שגיאת רשת. לא ניתן לעדכן את הסורק.');
    } finally {
      setToggling(false);
    }
  };

  const relativeTime = formatRelativeTime(lastScanIso);

  return (
    <section
      className="mb-6 sm:mb-8 p-4 sm:p-6 rounded-2xl border border-white/5 bg-zinc-900/50 backdrop-blur-md"
      aria-label="סטטוס מערכת — סורק השוק"
      dir="rtl"
    >
      <h2 className="text-lg font-semibold text-zinc-200 mb-3 flex items-center gap-2">
        <Activity className="w-5 h-5 text-amber-400" aria-hidden />
        סטטוס מערכת — סורק השוק
      </h2>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <span
            role="status"
            aria-label={active ? 'סורק שוק פעיל' : 'סורק שוק כבוי'}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full ${
              active ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30 animate-pulse' : 'bg-zinc-700/80 text-zinc-400'
            }`}
          >
            <span
              className={`inline-block w-2 h-2 rounded-full shrink-0 ${active ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500'}`}
              aria-hidden
            />
            {active ? 'פעיל' : 'לא פעיל'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-label={active ? 'כבה סורק שוק' : 'הפעל סורק שוק'}
            disabled={toggling}
            onClick={handleToggle}
            className={`
              relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900
              ${active ? 'border-emerald-500/60 bg-emerald-500/30' : 'border-zinc-600 bg-zinc-800'}
              ${toggling ? 'opacity-70 cursor-wait' : 'cursor-pointer'}
            `}
          >
            <span
              className={`
                pointer-events-none inline-block h-6 w-6 rounded-full shadow-sm ring-0 transition-transform duration-200
                ${active ? 'translate-x-5 bg-emerald-400' : 'translate-x-0.5 bg-zinc-400'}
              `}
            />
          </button>
        </div>
      </div>

      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2 text-zinc-300">
          <Clock className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden />
          <span>סריקה אחרונה:</span>
          <span className={`font-medium ${relativeTime === EMPTY_SCAN_LABEL ? 'text-zinc-500 italic' : 'text-zinc-100'}`} suppressHydrationWarning>
            {relativeTime}
          </span>
        </li>
        <li className="flex items-center gap-2 text-zinc-300">
          <Gem className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden />
          <span>ג&apos;מים שזוהו היום:</span>
          <span className="font-medium text-zinc-100">{gemsToday}</span>
        </li>
        {lastRunStats && (
          <li className="text-zinc-400 text-xs mt-1">
            מחזור אחרון: נסרקו {lastRunStats.coinsChecked} מטבעות, נמצאו {lastRunStats.gemsFound} ג&apos;מים, נשלחו {lastRunStats.alertsSent} התראות.
          </li>
        )}
        {lastDiagnostics?.summaryWhenZeroGems && (
          <li className="text-amber-200/90 text-xs mt-2 p-2 rounded-lg bg-amber-950/30 border border-amber-500/20" role="status">
            <span className="font-medium">בריאות סורק (מדוע אין ג&apos;מים):</span> {lastDiagnostics.summaryWhenZeroGems}
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-zinc-500">
        הסריקה מתבצעת אוטומטית על ידי Cron כל 20 דקות (Vercel). המתג למעלה מפעיל/מכבה את ההרשאה לסריקה.
      </p>
    </section>
  );
}
