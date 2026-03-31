/**
 * Claude model IDs for the Messages API (`POST /v1/messages`).
 * Primary: production-stable Sonnet 4 snapshot (May 2025).
 * Fallbacks tried in order when the primary returns 404 or fails.
 *
 * @see https://docs.anthropic.com/en/docs/about-claude/models
 */
/** Primary Anthropic model — production-stable snapshot (Expert 5 / On-Chain Sleuth). */
export const ANTHROPIC_SONNET_MODEL = 'claude-sonnet-4-5' as const;
export const ANTHROPIC_HAIKU_MODEL = 'claude-haiku-4-5' as const;
/** Secondary snapshot tried immediately on 404 from primary. */
export const ANTHROPIC_SONNET_FALLBACK_SNAPSHOT = 'claude-3-5-sonnet-20241022' as const;

export const ANTHROPIC_MODEL_CANDIDATES = [
  ANTHROPIC_SONNET_MODEL,
  ANTHROPIC_SONNET_FALLBACK_SNAPSHOT,
  ANTHROPIC_HAIKU_MODEL,
] as const;
