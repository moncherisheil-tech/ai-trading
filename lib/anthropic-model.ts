/** Dated Sonnet snapshots (e.g. 20241022) may 404 on some API tiers; `-latest` tracks the current 3.5 Sonnet. Haiku uses a stable dated ID. */
export const ANTHROPIC_SONNET_MODEL = 'claude-3-5-sonnet-latest';
export const ANTHROPIC_HAIKU_MODEL = 'claude-3-haiku-20240307';

export const ANTHROPIC_MODEL_CANDIDATES = [ANTHROPIC_SONNET_MODEL, ANTHROPIC_HAIKU_MODEL] as const;
