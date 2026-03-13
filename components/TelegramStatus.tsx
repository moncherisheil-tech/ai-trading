'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export default function TelegramStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}` : '';
    fetch(`${baseUrl}/api/ops/telegram/status`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setConnected(Boolean(data?.connected)))
      .catch(() => setConnected(false));
  }, []);

  if (connected === null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
        connected
          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
          : 'bg-slate-700/80 text-slate-500'
      }`}
      title={connected ? 'חיבור טלגרם פעיל' : 'טלגרם לא מוגדר'}
    >
      {connected ? (
        <Wifi className="w-3.5 h-3.5 text-emerald-400" aria-hidden />
      ) : (
        <WifiOff className="w-3.5 h-3.5 text-slate-400" aria-hidden />
      )}
      {connected ? 'חובר' : 'מנותק'}
    </span>
  );
}
