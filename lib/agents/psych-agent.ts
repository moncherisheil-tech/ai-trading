/**
 * Expert augmentations split by domain: Truth Matrix = sentiment/news only; order-book rules = technical only.
 * Consumed by consensus-engine (Psych vs Technician) and news-adjacent flows.
 */

/** Technical / microstructure only — inject into Technician & execution context, never into headline sentiment prompts. */
export const ORDER_BOOK_SPOOFING_RULES = `
SPOOFING & LIQUIDITY WALLS (Institutional):
- Analyze order book depth for "liquidity walls" that appear and vanish within short windows (classic spoofing).
- Flag SPOOFING_RISK when bid/ask walls are disproportionate vs traded volume, or when walls pull immediately as price approaches (lure then cancel).
- Do NOT treat a breakout as validated if depth evaporates — wait for sustained absorption or tape confirmation.
- Contrast real accumulation (fills, iceberg reload) vs fake breakout (wall cancels, thin trade-through).
`.trim();

/** @deprecated Use ORDER_BOOK_SPOOFING_RULES (technical domain). */
export const LEVIATHAN_SPOOFING_BOOK_RULES = ORDER_BOOK_SPOOFING_RULES;

/** Truth Matrix: tier sources, cross-validate rumors, counter-trade vs whale signal. */
export const TRUTH_MATRIX_RULES = `
THE TRUTH MATRIX (Anti–Fake News):
a) SOURCE TIERING: Assign trust weight — ~95% for .gov / Tier-1 wires (Reuters, Bloomberg, AP) / exchange official posts; ~40% mid-tier crypto media; ~10% Crypto Twitter / anonymous accounts.
b) CROSS-VALIDATION: Single-source euphoria or panic without corroboration → label narrative UNVERIFIED_RUMOR and down-weight for trading decisions.
c) COUNTER-TRADE: If headline sentiment = Panic/Crash but headlines lack corroboration from Tier-1 sources, label UNVERIFIED_RUMOR — do not infer order-book, tape, or technical structure from headlines alone.
`.trim();

/** Sentiment / news hygiene only — for Psych expert and news-agent; no order-book or tape logic. */
export function buildSentimentExpertAugmentation(): string {
  return TRUTH_MATRIX_RULES;
}

/** Order book & spoofing — for Technical expert and Leviathan pipeline only. */
export function buildTechnicalLiquidityAugmentation(): string {
  return ORDER_BOOK_SPOOFING_RULES;
}

/** @deprecated Prefer buildSentimentExpertAugmentation (Psych) or buildTechnicalLiquidityAugmentation (Technician). */
export function buildPsychExpertAugmentation(): string {
  return buildSentimentExpertAugmentation();
}

export type NewsTrustTier = 'TIER1_OFFICIAL' | 'MID_TIER' | 'SOCIAL_LOW';

/** Rough URL/host tiering for downstream RAG or news agents. */
export function tierFromSourceHint(hint: string): NewsTrustTier {
  const h = (hint || '').toLowerCase();
  if (/\.gov(\/|$)/.test(h) || /sec\.gov|treasury|fed\.|europa\.eu/.test(h)) return 'TIER1_OFFICIAL';
  if (/reuters|bloomberg|apnews|ft\.com|wsj/.test(h)) return 'TIER1_OFFICIAL';
  if (/twitter\.com|x\.com|t\.me|reddit/.test(h)) return 'SOCIAL_LOW';
  return 'MID_TIER';
}

export function trustWeightPctForTier(tier: NewsTrustTier): number {
  switch (tier) {
    case 'TIER1_OFFICIAL':
      return 95;
    case 'MID_TIER':
      return 40;
    case 'SOCIAL_LOW':
      return 10;
    default:
      return 40;
  }
}
