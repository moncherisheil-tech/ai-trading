'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { getTelegramStatusAction } from '@/app/actions';

export default function TelegramStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [subscribersCount, setSubscribersCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    const fetchStatus = async () => {
      try {
        const out = await getTelegramStatusAction();
        const data = out.success ? (out.data as { connected?: boolean; subscribersCount?: number }) : null;
        if (!mounted) return;
        if (!data) {
          setConnected(false);
          setSubscribersCount(0);
          return;
        }
        setConnected(Boolean(data.connected));
        setSubscribersCount(Number.isFinite(Number(data.subscribersCount)) ? Number(data.subscribersCount) : 0);
      } catch {
        if (!mounted) return;
        setConnected(false);
        setSubscribersCount(0);
      }
    };

    void fetchStatus();
    const id = setInterval(() => void fetchStatus(), 15000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  if (connected === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-slate-700/70 text-slate-300 ring-1 ring-slate-600/40">
        AWAITING_LIVE_DATA
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
        connected
          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
          : 'bg-slate-700/80 text-slate-500'
      }`}
      title={connected ? `חיבור טלגרם פעיל (${subscribersCount} מנויים)` : 'טלגרם לא מוגדר'}
    >
      {connected ? (
        <Wifi className="w-3.5 h-3.5 text-emerald-400" aria-hidden />
      ) : (
        <WifiOff className="w-3.5 h-3.5 text-slate-400" aria-hidden />
      )}
      {connected ? `חובר (${subscribersCount})` : 'מנותק'}
    </span>
  );
}
