'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export const SIMULATION_FEE_PCT = 0.1;
export const INITIAL_WALLET_USD = 10_000;

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
  ) => { success: true } | { success: false; error: string };
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

  const setSelectedSymbol = useCallback((symbol: string) => {
    const base = (symbol || 'BTC').trim().toUpperCase();
    setState((prev) => ({ ...prev, selectedSymbol: base || prev.selectedSymbol }));
  }, []);

  const addTrade = useCallback(
    (
      symbol: string,
      side: 'buy' | 'sell',
      price: number,
      amountUsd: number
    ): { success: true } | { success: false; error: string } => {
      const normalizedSymbol = symbol.toUpperCase().endsWith('USDT')
        ? symbol.toUpperCase()
        : `${symbol.toUpperCase()}USDT`;

      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amountUsd) || amountUsd <= 0) {
        return { success: false, error: 'INVALID_INPUT' };
      }

      const feeUsd = (amountUsd * SIMULATION_FEE_PCT) / 100;
      const totalCost = side === 'buy' ? amountUsd + feeUsd : amountUsd - feeUsd;
      const amountAsset = amountUsd / price;

      // Snapshot-based validation (good enough for single-user UI).
      const { walletUsd, trades } = state;

      if (side === 'buy' && walletUsd < totalCost) {
        return { success: false, error: 'INSUFFICIENT_FUNDS' };
      }

      if (side === 'sell') {
        const boughtForSymbol = trades
          .filter((t) => t.symbol === normalizedSymbol && t.side === 'buy')
          .reduce((sum, t) => sum + t.amountAsset, 0);
        const soldForSymbol = trades
          .filter((t) => t.symbol === normalizedSymbol && t.side === 'sell')
          .reduce((sum, t) => sum + t.amountAsset, 0);
        const available = boughtForSymbol - soldForSymbol;
        if (amountAsset > available + 1e-8) {
          return { success: false, error: 'INSUFFICIENT_ASSET' };
        }
      }

      const newWallet =
        side === 'buy' ? walletUsd - totalCost : walletUsd + (amountUsd - feeUsd);

      const trade: SimulationTrade = {
        id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        symbol: normalizedSymbol,
        side,
        price,
        amountUsd,
        amountAsset,
        feeUsd,
        timestamp: Date.now(),
        dateLabel: new Date().toLocaleTimeString('he-IL', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      };

      setState((prev) => ({
        ...prev,
        walletUsd: Math.round(newWallet * 100) / 100,
        trades: [trade, ...prev.trades],
      }));

      return { success: true };
    },
    [state]
  );

  const resetSimulation = useCallback(() => {
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
