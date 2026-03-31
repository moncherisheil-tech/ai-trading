/**
 * Claude model IDs for the Messages API (`POST /v1/messages`).
 * Primary: production Sonnet 4.6. Fallback: Sonnet 4 snapshot.
 *
 * @see https://docs.anthropic.com/en/docs/about-claude/models
 */
/** Primary Anthropic model — 2026 production Sonnet (Expert 5 / On-Chain Sleuth). */
export const ANTHROPIC_SONNET_MODEL = 'claude-4.6-sonnet-20260215' as const;
export const ANTHROPIC_HAIKU_MODEL = 'claude-haiku-4-5-20251001' as const;
/** Snapshot used when the primary is not available for the API key. */
export const ANTHROPIC_SONNET_FALLBACK_SNAPSHOT = 'claude-4-sonnet-20250514' as const;

export const ANTHROPIC_MODEL_CANDIDATES = [
  ANTHROPIC_SONNET_MODEL,
  ANTHROPIC_SONNET_FALLBACK_SNAPSHOT,
  ANTHROPIC_HAIKU_MODEL,
] as const;
