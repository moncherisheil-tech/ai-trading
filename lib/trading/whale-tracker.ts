/**
 * Public entry point for per-symbol whale-data enrichment.
 *
 * ── SOVEREIGN ALERT PIPELINE ─────────────────────────────────────────────
 * Real-time whale alerts flow exclusively through:
 *   Redis Pub/Sub (88.99.208.99) → lib/redis/whale-subscriber.ts
 *     → BullMQ "quantum-core-queue" → lib/core/orchestrator.ts
 * No HTTP fallbacks. No external whale API keys. Event-driven only.
 *
 * ── THIS MODULE ───────────────────────────────────────────────────────────
 * Provides supplementary per-symbol whale context (Binance aggTrades,
 * public endpoint — no API key required) for lib/analysis-core.ts and
 * lib/alpha-engine.ts.  Results are used to enrich AI analysis prompts;
 * they do NOT drive trade execution.
 *
 * Removed providers (Operation "Clean Slate"):
 *   ✗  Server B HTTP Relay  (WHALE_PROXY_URL)
 *   ✗  CryptoQuant API      (CRYPTOQUANT_API_KEY)
 *   ✗  Whale Alert API      (WHALE_ALERT_API_KEY)
 */

export type {
  WhaleWalletType,
  WhaleMovementDirection,
  WhaleMovement,
  WhaleMovementsResult,
} from '@/lib/whales/types';

export { getRecentWhaleMovementsOrchestrated as getRecentWhaleMovements } from '@/lib/whales/index';
