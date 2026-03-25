'use client';

import { useState, useEffect } from 'react';
import { Shield, AlertTriangle } from 'lucide-react';

type MarketRiskStatus = 'SAFE' | 'DANGEROUS';

interface MarketRiskSentiment {
  status: MarketRiskStatus;
  reasoning: string;
  checkedAt: string;
}

const SAFE_LABEL = 'שוק יציב — תנאים אופטימליים';
const DANGER_LABEL = 'אזהרת סיכון: תנודתיות גבוהה — מומלץ להימנע ממסחר';

export default function MarketSafetyBanner() {
  const [data, setData] = useState<MarketRiskSentiment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchRisk() {
      try {
        const res = await fetch('/api/market/risk', { cache: 'no-store', credentials: 'include' });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as MarketRiskSentiment;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ status: 'SAFE', reasoning: '—', checkedAt: new Date().toISOString() });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchRisk();
    return () => { cancelled = true; };
  }, []);

  if (loading || !data) {
    return (
      <div
        className="w-full py-2.5 px-4 bg-zinc-800/80 border-b border-white/5 text-center text-sm text-zinc-400"
        dir="rtl"
        aria-label="טוען סטטוס בטיחות שוק"
      >
        <span className="cyber-decrypt text-[11px] font-semibold tracking-[0.2em]" data-scramble="RISK-CHECK-72">
          MARKET RISK SCAN
        </span>
      </div>
    );
  }

  const isSafe = data.status === 'SAFE';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full py-3 px-4 sm:px-6 border-b flex items-center justify-center gap-2 flex-wrap text-sm sm:text-base font-semibold min-h-[44px] ${
        isSafe
          ? 'bg-emerald-950/80 border-b border-emerald-500/30 text-emerald-100'
          : 'bg-rose-950/80 border-b border-rose-500/30 text-rose-100'
      }`}
      dir="rtl"
    >
      {isSafe ? (
        <Shield className="w-4 h-4 shrink-0 text-emerald-400 animate-pulse" aria-hidden />
      ) : (
        <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 animate-pulse" aria-hidden />
      )}
      <span>{isSafe ? SAFE_LABEL : DANGER_LABEL}</span>
      {data.reasoning && (
        <span className="text-xs opacity-90 font-normal max-w-2xl truncate" title={data.reasoning}>
          ({data.reasoning})
        </span>
      )}
    </div>
  );
}
