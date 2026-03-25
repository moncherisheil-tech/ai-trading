'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { round2, round4, toDecimal, D, roundToSymbolDecimals } from '@/lib/decimal';

export const SIMULATION_FEE_PCT = 0.1;
/** Single source of truth: must match lib/decimal.ts D.startingBalance (used by simulation API and PnL). */
export const INITIAL_WALLET_USD = D.startingBalance.toNumber();

function computeWalletFromTrades(trades: SimulationTrade[]): number {
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  let w = D.startingBalance;
  for (const t of sorted) {
    if (t.side === 'buy') {
      w = w.minus(toDecimal(t.amountUsd).plus(t.feeUsd));
    } else {
      w = w.plus(toDecimal(t.amountUsd).minus(t.feeUsd));
    }
  }
  return round2(w);
}

export interface SimulationTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  amountUsd: number;
  amountAsset: number;
  feeUsd: number;
  timestamp: number;
  dateLabel: string;
}

export interface ExecutionMarker {
  type: 'buy' | 'sell';
  price: number;
  date: string;
  amountAsset: number;
}

interface SimulationState {
  selectedSymbol: string;
  walletUsd: number;
  trades: SimulationTrade[];
}

interface SimulationContextValue extends SimulationState {
  setSelectedSymbol: (symbol: string) => void;
  /**
   * Add a simulated trade for a specific symbol.
   * Returns { success: false, error } when validation fails so the UI can show
   * a professional error message instead of silently ignoring the action.
   */
  addTrade: (
    symbol: string,
    side: 'buy' | 'sell',
    price: number,
    amountUsd: number
  ) => Promise<{ success: true } | { success: false; error: string; message?: string }>;
  resetSimulation: () => void;
  getMarkersForSymbol: (symbol: string) => ExecutionMarker[];
  getTradesForSymbol: (symbol: string) => SimulationTrade[];
}

const defaultState: SimulationState = {
  selectedSymbol: 'BTC',
  walletUsd: INITIAL_WALLET_USD,
  trades: [],
};

const SimulationContext = createContext<SimulationContextValue | null>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SimulationState>(defaultState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/simulation/trades', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { trades: [] }))
      .then((data: { trades?: Array<{ id: string; symbol: string; side: 'buy' | 'sell'; price: number; amountUsd: number; amountAsset: number; feeUsd: number; timestamp: number; dateLabel: string }> }) => {
        if (cancelled || !Array.isArray(data.trades) || data.trades.length === 0) {
          if (!cancelled) setHydrated(true);
          return;
        }
        const trades = data.trades.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          price: t.price,
          amountUsd: t.amountUsd,
          amountAsset: t.amountAsset,
          feeUsd: t.feeUsd,
          timestamp: t.timestamp,
          dateLabel: t.dateLabel,
        }));
        const walletUsd = computeWalletFromTrades(trades);
        setState((prev) => ({ ...prev, trades, walletUsd }));
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
    return () => { cancelled = true; };
  }, []);

  const setSelectedSymbol = useCallback((symbol: string) => {
    const base = (symbol || 'BTC').trim().toUpperCase();
    setState((prev) => ({ ...prev, selectedSymbol: base || prev.selectedSymbol }));
  }, []);

  const addTrade = useCallback(
    async (
      symbol: string,
      side: 'buy' | 'sell',
      price: number,
      amountUsd: number
    ): Promise<{ success: true } | { success: false; error: string; message?: string }> => {
      const normalizedSymbol = symbol.toUpperCase().endsWith('USDT')
        ? symbol.toUpperCase()
        : `${symbol.toUpperCase()}USDT`;

      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amountUsd) || amountUsd <= 0) {
        return { success: false, error: 'INVALID_INPUT' };
      }

      const amt = toDecimal(amountUsd);
      const pr = toDecimal(price);
      if (pr.isZero()) return { success: false, error: 'INVALID_INPUT' };
      const feeUsd = round4(amt.times(SIMULATION_FEE_PCT).div(100));
      const totalCost = side === 'buy' ? round2(amt.plus(feeUsd)) : round2(amt.minus(feeUsd));
      const amountAsset = roundToSymbolDecimals(amt.div(pr), normalizedSymbol, 'amount');

      // Snapshot-based validation (good enough for single-user UI).
      const { walletUsd, trades } = state;

      if (side === 'buy' && toDecimal(walletUsd).lessThan(totalCost)) {
        return { success: false, error: 'INSUFFICIENT_FUNDS' };
      }

      if (side === 'sell') {
        const boughtForSymbol = trades
          .filter((t) => t.symbol === normalizedSymbol && t.side === 'buy')
          .reduce((sum, t) => sum + t.amountAsset, 0);
        const soldForSymbol = trades
          .filter((t) => t.symbol === normalizedSymbol && t.side === 'sell')
          .reduce((sum, t) => sum + t.amountAsset, 0);
        const available = toDecimal(boughtForSymbol).minus(soldForSymbol);
        if (toDecimal(amountAsset).greaterThan(available.plus('0.00000001'))) {
          return { success: false, error: 'INSUFFICIENT_ASSET' };
        }
      }

      const newWallet = side === 'buy'
        ? toDecimal(walletUsd).minus(totalCost)
        : toDecimal(walletUsd).plus(amt.minus(feeUsd));

      const timestamp = Date.now();
      const trade: SimulationTrade = {
        id: `sim-${crypto.randomUUID()}`,
        symbol: normalizedSymbol,
        side,
        price,
        amountUsd,
        amountAsset,
        feeUsd,
        timestamp,
        dateLabel: new Date().toLocaleTimeString('he-IL', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      };

      const body = {
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        price: trade.price,
        amountUsd: trade.amountUsd,
        amountAsset: trade.amountAsset,
        feeUsd: trade.feeUsd,
        timestamp: trade.timestamp,
        dateLabel: trade.dateLabel,
      };
      const res = await fetch('/api/simulation/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        return {
          success: false,
          error: result.error ?? 'PERSISTENCE_FAILED',
          message: typeof result.message === 'string' ? result.message : undefined,
        };
      }

      setState((prev) => ({
        ...prev,
        walletUsd: round2(newWallet),
        trades: [trade, ...prev.trades],
      }));

      return { success: true };
    },
    [state]
  );

  const resetSimulation = useCallback(async () => {
    try {
      await fetch('/api/simulation/reset', { method: 'POST', credentials: 'include' });
    } catch {
      // still clear local state
    }
    setState(defaultState);
  }, []);

  const getMarkersForSymbol = useCallback(
    (symbol: string): ExecutionMarker[] => {
      const normalized = symbol.toUpperCase().endsWith('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
      return state.trades
        .filter((t) => t.symbol === normalized)
        .map((t) => ({
          type: t.side,
          price: t.price,
          date: new Date(t.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          amountAsset: t.amountAsset,
        }));
    },
    [state.trades]
  );

  const getTradesForSymbol = useCallback(
    (symbol: string): SimulationTrade[] => {
      const normalized = symbol.toUpperCase().endsWith('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
      return state.trades.filter((t) => t.symbol === normalized);
    },
    [state.trades]
  );

  const value = useMemo<SimulationContextValue>(
    () => ({
      ...state,
      setSelectedSymbol,
      addTrade,
      resetSimulation,
      getMarkersForSymbol,
      getTradesForSymbol,
    }),
    [state, setSelectedSymbol, addTrade, resetSimulation, getMarkersForSymbol, getTradesForSymbol]
  );

  return (
    <SimulationContext.Provider value={value}>
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation(): SimulationContextValue {
  const ctx = useContext(SimulationContext);
  if (!ctx) {
    throw new Error('useSimulation must be used within SimulationProvider');
  }
  return ctx;
}

export function useSimulationOptional(): SimulationContextValue | null {
  return useContext(SimulationContext);
}
