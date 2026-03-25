/**
 * Real-time Twitter/X sentiment for Psych Agent.
 * No demo data: when real API (e.g. Twitter API v2) is not configured, returns empty tweets and neutral summary.
 * Integrate real API in this module when keys are available.
 */

export interface TwitterSentimentResult {
  tweets: string[];
  summary: string;
}

/** Fetches real-time tweets for symbol. Returns empty tweets + neutral summary when no API is configured. */
export async function fetchTwitterSentiment(_symbol: string): Promise<TwitterSentimentResult> {
  await Promise.resolve();
  // No hardcoded demo tweets — use real Twitter/sentiment API when configured; otherwise neutral.
  return {
    tweets: [],
    summary: 'אין נתוני רשת חברתית זמינים כרגע — הניתוח מתבסס על מקורות אחרים.',
  };
}
