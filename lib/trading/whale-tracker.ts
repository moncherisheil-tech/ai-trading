/**
 * Public entry point for whale-tracking data.
 *
 * All analysis logic has been moved to lib/whales/ for clean separation:
 *   lib/whales/types.ts               — shared interfaces
 *   lib/whales/whale-alert-provider.ts — Whale Alert API (new primary)
 *   lib/whales/index.ts               — provider priority chain
 *
 * This file re-exports types and the main function so every existing caller
 * (analysis-core.ts, consensus-engine.ts, leviathan.ts, etc.) continues to
 * work with zero import-path changes.
 *
 * Provider priority:
 *   1. CryptoQuant  — attempted first; fast-fails on 2026 404 paths
 *   2. Whale Alert  — real-time on-chain txns ≥$500k (BTC / ETH + more)
 *   3. Binance      — public aggTrades proxy, no API key required
 */

export type {
  WhaleWalletType,
  WhaleMovementDirection,
  WhaleMovement,
  WhaleMovementsResult,
} from '@/lib/whales/types';

export { getRecentWhaleMovementsOrchestrated as getRecentWhaleMovements } from '@/lib/whales/index';
