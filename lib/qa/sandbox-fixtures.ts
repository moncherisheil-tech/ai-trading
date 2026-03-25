import type { ConsensusMockPayload } from '@/lib/consensus-engine';

export const SANDBOX_CONSENSUS_INPUT = {
  symbol: 'BTCUSDT',
  current_price: 67320,
  rsi_14: 56,
  atr_value: 1120,
  atr_pct_of_price: 1.66,
  macd_signal: 0.84,
  volume_profile_summary: 'Cached QA profile: HVN support around 66,400 and resistance around 68,200.',
  hvn_levels: [66400, 67300, 68200],
  nearest_sr_distance_pct: 1.3,
  volatility_pct: 2.1,
  asset_momentum: 'מומנטום חיובי יציב עם דחיפה מעל EMA50.',
  macro_context: 'Cached macro: DXY neutral-to-soft, ETF flows positive.',
  order_book_summary: 'Cached order book: bid wall at 66.9k, ask wall at 68.3k.',
  open_interest_signal: 'OI עולה מתון עם מחיר יציב.',
  onchain_metric_shift: 'Cached Leviathan: net outflow קל מהבורסות עם צבירה מתונה.',
  institutional_whale_context: 'Leviathan cached feed: CQ whale ratio neutral-positive, CMC volume stable.',
  btc_trend: 'bullish' as const,
};

export const SANDBOX_MOCK_PAYLOAD: ConsensusMockPayload = {
  tech: {
    tech_score: 87,
    tech_logic: 'מבנה טכני חיובי עם תמיכה ב-HVN וסטייה חיובית מתונה; עדיפות להמשך מגמה.',
  },
  risk: {
    risk_score: 81,
    risk_logic: 'R:R מעל 1:2, תנודתיות נשלטת, וגודל פוזיציה שמרני עומד בכללי סיכון.',
  },
  psych: {
    psych_score: 79,
    psych_logic: 'סנטימנט יציב ללא אופוריה קיצונית; נתוני מימון ו-OI תומכים בתרחיש חיובי.',
  },
  macro: {
    macro_score: 83,
    macro_logic: 'מקרו ניטרלי-חיובי עם לחץ דולר מתון וזרימת הון מוסדית תומכת.',
  },
  onchain: {
    onchain_score: 86,
    onchain_logic: 'זרימות On-Chain מצביעות על צבירה הדרגתית ולחץ מכירה נמוך.',
  },
  deepMemory: {
    deep_memory_score: 82,
    deep_memory_logic: 'עסקאות דומות הראו יתרון כאשר On-Chain חיובי יחד עם משמעת סיכון.',
  },
  judge: {
    master_insight_he: 'קונצנזוס מלא של מועצת ה-AI: התנאים בשלים ל-Alpha Signal חיובי תחת ניהול סיכון שמרני.',
    reasoning_path: 'הצלבת ששת המומחים מראה תמיכה רב-שכבתית ללא קונפליקט מהותי.',
  },
};

export const SANDBOX_LLM_RAW = {
  anthropic:
    'Anthropic cached raw response: {"sentiment":"constructive","note":"market structure remains supportive"}',
  groq:
    'Groq cached raw response: {"macro_score":83,"macro_logic":"ETF inflows offset short-term volatility"}',
  gemini:
    'Gemini cached raw response: {"direction":"Bullish","probability":84,"target_percentage":2.4}',
};
