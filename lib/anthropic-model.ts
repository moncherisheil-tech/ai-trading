/** Dated IDs — `-latest` aliases have caused 404s when retired or mismatched to the account region. */
export const ANTHROPIC_SONNET_MODEL = 'claude-3-5-sonnet-20241022';
export const ANTHROPIC_HAIKU_MODEL = 'claude-3-5-haiku-20241022';

export const ANTHROPIC_MODEL_CANDIDATES = [ANTHROPIC_SONNET_MODEL, ANTHROPIC_HAIKU_MODEL] as const;
