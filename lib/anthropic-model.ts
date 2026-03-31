/**
 * Claude model IDs for the Messages API (`POST /v1/messages`).
 * Primary: platform default Sonnet alias. Fallbacks cover orgs where an alias 404s.
 *
 * @see https://docs.anthropic.com/en/docs/about-claude/models
 */
/** Primary Anthropic model — locked to claude-3-5-sonnet-latest (Expert 5 / On-Chain Sleuth). */
export const ANTHROPIC_SONNET_MODEL = 'claude-3-5-sonnet-latest' as const;
export const ANTHROPIC_HAIKU_MODEL = 'claude-haiku-4-5-20251001' as const;
/** Snapshot used when `claude-3-5-sonnet-latest` is not available for the API key. */
export const ANTHROPIC_SONNET_FALLBACK_SNAPSHOT = 'claude-sonnet-4-20250514' as const;

export const ANTHROPIC_MODEL_CANDIDATES = [
  ANTHROPIC_SONNET_MODEL,
  ANTHROPIC_SONNET_FALLBACK_SNAPSHOT,
  ANTHROPIC_HAIKU_MODEL,
] as const;
