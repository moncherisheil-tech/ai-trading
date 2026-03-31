/**
 * Claude model IDs for the Messages API (`POST /v1/messages`).
 *
 * - Aliases like `claude-3-5-sonnet-latest` are rejected with 404 `not_found_error`.
 * - Older 3.5 snapshot IDs may be absent from newer org catalogs (only Claude 4.x listed).
 *
 * Values below match IDs returned by `GET /v1/models` for current API keys; adjust if your
 * workspace exposes a different set.
 *
 * @see https://docs.anthropic.com/en/docs/about-claude/models
 */
export const ANTHROPIC_SONNET_MODEL = 'claude-sonnet-4-20250514';
export const ANTHROPIC_HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export const ANTHROPIC_MODEL_CANDIDATES = [ANTHROPIC_SONNET_MODEL, ANTHROPIC_HAIKU_MODEL] as const;
