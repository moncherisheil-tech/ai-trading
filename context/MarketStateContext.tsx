'use client';

import dynamic from 'next/dynamic';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { MarketRiskSentiment } from '@/lib/market-sentinel';

export type DefconLevel = 1 | 2 | 3 | 5;

export type MarketStateValue = {
  sentiment: MarketRiskSentiment | null;
  loading: boolean;
  /** 0 = calm obsidian, 1 = aggressive storm */
  volatilityNormalized: number;
  /** Animation speed multiplier for shader */
  kineticSpeed: number;
  /** Turbulence / noise amount for shader */
  turbulence: number;
  defcon: DefconLevel;
  isDefcon1: boolean;
  /** Black swan / flash-crash proxy from market metrics */
  blackSwanProxy: boolean;
  refresh: () => Promise<void>;
};

const MarketStateContext = createContext<MarketStateValue | null>(null);

function computeVolatilityMetrics(s: MarketRiskSentiment | null): {
  volatilityNormalized: number;
  kineticSpeed: number;
  turbulence: number;
  defcon: DefconLevel;
  isDefcon1: boolean;
  blackSwanProxy: boolean;
} {
  if (!s) {
    return {
      volatilityNormalized: 0.15,
      kineticSpeed: 0.35,
      turbulence: 0.12,
      defcon: 5,
      isDefcon1: false,
      blackSwanProxy: false,
    };
  }
  const btcV = s.btc24hVolatilityPct ?? 0;
  const ethV = s.eth24hVolatilityPct ?? 0;
  const btcA = s.btcAtrPct ?? 0;
  const ethA = s.ethAtrPct ?? 0;
  const maxVol = Math.max(btcV, ethV);
  const maxAtr = Math.max(btcA, ethA);

  const normalized = Math.min(1, Math.max(0, maxVol / 14));
  const atrBoost = Math.min(1, maxAtr / 8);
  const combined = Math.min(1, normalized * 0.72 + atrBoost * 0.35);

  const kineticSpeed = 0.25 + combined * 2.65;
  const turbulence = 0.08 + combined * 0.92;

  const dangerous = s.status === 'DANGEROUS';
  const blackSwanProxy = dangerous && (maxVol >= 8 || maxAtr >= 5);
  const isDefcon1 = blackSwanProxy;
  let defcon: DefconLevel = 5;
  if (isDefcon1) defcon = 1;
  else if (dangerous) defcon = 2;
  else if (maxVol >= 4 || maxAtr >= 3) defcon = 3;
  else defcon = 5;

  return {
    volatilityNormalized: combined,
    kineticSpeed,
    turbulence,
    defcon,
    isDefcon1,
    blackSwanProxy,
  };
}

const VolatilityShaderBackground = dynamic(
  () => import('@/components/VolatilityShaderBackground').then((m) => m.default),
  { ssr: false }
);

export function MarketStateProvider({ children }: { children: React.ReactNode }) {
  const [sentiment, setSentiment] = useState<MarketRiskSentiment | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/market/risk', { cache: 'no-store', credentials: 'include' });
      if (!res.ok) return;
      const json = (await res.json()) as MarketRiskSentiment;
      setSentiment(json);
    } catch {
      // keep sentinel
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 18_000);
    return () => clearInterval(t);
  }, [refresh]);

  const metrics = useMemo(() => computeVolatilityMetrics(sentiment), [sentiment]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-defcon', String(metrics.defcon));
    document.documentElement.setAttribute('data-defcon1', metrics.isDefcon1 ? '1' : '0');
  }, [metrics.defcon, metrics.isDefcon1]);

  const value = useMemo<MarketStateValue>(
    () => ({
      sentiment,
      loading,
      volatilityNormalized: metrics.volatilityNormalized,
      kineticSpeed: metrics.kineticSpeed,
      turbulence: metrics.turbulence,
      defcon: metrics.defcon,
      isDefcon1: metrics.isDefcon1,
      blackSwanProxy: metrics.blackSwanProxy,
      refresh,
    }),
    [sentiment, loading, metrics, refresh]
  );

  return (
    <MarketStateContext.Provider value={value}>
      <VolatilityShaderBackground
        kineticSpeed={metrics.kineticSpeed}
        turbulence={metrics.turbulence}
        volatilityNormalized={metrics.volatilityNormalized}
        isDefcon1={metrics.isDefcon1}
      />
      {children}
    </MarketStateContext.Provider>
  );
}

const FALLBACK_STATE: MarketStateValue = {
  sentiment: null,
  loading: true,
  volatilityNormalized: 0.15,
  kineticSpeed: 0.35,
  turbulence: 0.12,
  defcon: 5,
  isDefcon1: false,
  blackSwanProxy: false,
  refresh: async () => {},
};

export function useMarketState(): MarketStateValue {
  return useContext(MarketStateContext) ?? FALLBACK_STATE;
}

/** When provider is absent (e.g. login page), returns null. */
export function useMarketStateOptional(): MarketStateValue | null {
  return useContext(MarketStateContext);
}
