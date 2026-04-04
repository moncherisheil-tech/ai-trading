'use client';

/**
 * LiveExecutionStreamContext — single SSE pipe for the entire dashboard.
 *
 * Replaces all component-level polling with one persistent EventSource per
 * browser tab.  Components read `snap` and `marketRisk` reactively;
 * the server pushes fresh data every 20 s via /api/live/stream.
 *
 * Reconnection uses capped exponential back-off:
 *   1 s → 2 s → 4 s → 8 s → 16 s → 30 s (ceiling)
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ── Shared types (mirror server types without importing server-only modules) ─

export type StreamExecutionSnap = {
  mode: 'PAPER' | 'LIVE';
  masterSwitchEnabled: boolean;
  minConfidenceToExecute: number;
  liveApiKeyConfigured: boolean;
  liveLocked: boolean;
  goLiveSafetyAcknowledged: boolean;
  virtualBalanceUsd: number;
  winRatePct: number;
  activeTradesCount: number;
  robotHandshakeAt: string | null;
  robotHandshakeSource: 'telegram' | 'dashboard' | null;
  activeTrades: Array<{
    id: number;
    symbol: string;
    entryPrice: number;
    currentPrice: number;
    amountUsd: number;
    unrealizedPnlUsd: number;
    unrealizedPnlPct: number;
    targetProfitPct: number;
    stopLossPct: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    analysisReasoning: {
      reason: string | null;
      overseerSummary: string | null;
      overseerReasoningPath: string | null;
      expertBreakdown: Record<string, unknown> | null;
      createdAt: string | null;
    } | null;
  }>;
  recentExecutions: Array<{
    id: number;
    symbol: string;
    signal: 'BUY' | 'SELL';
    confidence: number;
    mode: 'PAPER' | 'LIVE';
    status: string;
    executed: boolean;
    reason: string | null;
    overseerSummary: string | null;
    overseerReasoningPath: string | null;
    expertBreakdown: Record<string, unknown> | null;
    executionPrice: number | null;
    amountUsd: number | null;
    virtualTradeId: number | null;
    createdAt: string;
  }>;
  alphaEvolution?: Array<{
    closedAt: string;
    cumulativePnlUsd: number;
    rollingWinRatePct: number;
  }>;
};

export type StreamMarketRisk = {
  status: 'SAFE' | 'DANGEROUS';
  reasoning: string;
  btc24hVolatilityPct: number | null;
  eth24hVolatilityPct: number | null;
  btcAtrPct: number | null;
  ethAtrPct: number | null;
  checkedAt: string;
};

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

export type LiveExecutionStreamValue = {
  snap: StreamExecutionSnap | null;
  marketRisk: StreamMarketRisk | null;
  streamStatus: StreamStatus;
  /** Force an immediate server-side snapshot push (e.g., after a write action). */
  forceRefresh: () => void;
};

// ── Constants ──────────────────────────────────────────────────────────────

const SSE_URL = '/api/live/stream';
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

// ── Context ────────────────────────────────────────────────────────────────

const LiveExecutionStreamContext = createContext<LiveExecutionStreamValue>({
  snap: null,
  marketRisk: null,
  streamStatus: 'connecting',
  forceRefresh: () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────

export function LiveExecutionStreamProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<StreamExecutionSnap | null>(null);
  const [marketRisk, setMarketRisk] = useState<StreamMarketRisk | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');

  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Close any existing connection before opening a new one.
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setStreamStatus((prev) => (prev === 'live' ? 'reconnecting' : 'connecting'));

    const es = new EventSource(SSE_URL, { withCredentials: true });
    esRef.current = es;

    es.addEventListener('connected', () => {
      if (!mountedRef.current) return;
      retryCountRef.current = 0;
      setStreamStatus('live');
    });

    es.addEventListener('execution_snapshot', (e: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(e.data) as StreamExecutionSnap;
        setSnap(data);
        setStreamStatus('live');
      } catch {
        // Malformed event — ignore.
      }
    });

    es.addEventListener('market_risk', (e: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(e.data) as StreamMarketRisk;
        setMarketRisk(data);
      } catch {
        // Malformed event — ignore.
      }
    });

    // Forward alpha pipeline events without extra parsing cost.
    es.addEventListener('alpha_job', () => {
      // Components that care about alpha events can watch streamStatus updates.
      // We intentionally leave heavy alpha-report state to the dedicated
      // AlphaSignalsDashboard component (it already fetches on demand).
    });

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close();
      esRef.current = null;
      setStreamStatus('reconnecting');

      // Capped exponential back-off.
      const delay = Math.min(
        BACKOFF_BASE_MS * 2 ** retryCountRef.current,
        BACKOFF_MAX_MS,
      );
      retryCountRef.current += 1;

      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);

  /**
   * forceRefresh — closes and immediately reopens the EventSource.
   * The server sends a fresh snapshot on every new connection,
   * so this gives components instant feedback after a write action
   * without any additional polling.
   */
  const forceRefresh = useCallback(() => {
    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    connect();
  }, [connect]);

  return (
    <LiveExecutionStreamContext.Provider value={{ snap, marketRisk, streamStatus, forceRefresh }}>
      {children}
    </LiveExecutionStreamContext.Provider>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export function useLiveExecutionStream(): LiveExecutionStreamValue {
  return useContext(LiveExecutionStreamContext);
}
