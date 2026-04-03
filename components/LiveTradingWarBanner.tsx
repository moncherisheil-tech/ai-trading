'use client';

import { useAppSettings } from '@/context/AppSettingsContext';

/**
 * Persistent LIVE trading warning: DB execution.mode LIVE and/or public env mirror.
 */
export default function LiveTradingWarBanner() {
  const { settings } = useAppSettings();
  const envFlag =
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_LIVE_TRADING_ENABLED === 'true';
  const dbLive = settings?.execution?.mode === 'LIVE';

  if (!envFlag && !dbLive) return null;

  return (
    <div
      className="pointer-events-none col-span-full md:col-span-2 sticky top-0 z-[200] flex justify-center px-2 py-1 pt-[max(0.25rem,env(safe-area-inset-top))]"
      role="status"
      aria-live="polite"
    >
      <div className="live-war-banner max-w-4xl rounded-b-xl border border-red-500/80 bg-red-950/95 px-4 py-2.5 text-center backdrop-blur-md">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-red-100">
          LIVE TRADING ARMED
        </p>
        <p className="mt-0.5 text-[11px] font-semibold text-red-200/95">
          מצב בורסה חי פעיל — פקודות עלולות לבצע עסקאות אמיתיות. ניטור מתמיד נדרש.
        </p>
      </div>
    </div>
  );
}
