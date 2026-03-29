/** Claude 4.5 generation — primary Sonnet, Haiku for fast paths and heartbeat failover. */
export const ANTHROPIC_SONNET_MODEL = 'claude-4-5-sonnet';
export const ANTHROPIC_HAIKU_MODEL = 'claude-4-5-haiku';

export const ANTHROPIC_MODEL_CANDIDATES = [ANTHROPIC_SONNET_MODEL, ANTHROPIC_HAIKU_MODEL] as const;
