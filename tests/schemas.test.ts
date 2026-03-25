import { describe, expect, it } from 'vitest';
import { aiPredictionSchema, sourceCitationSchema } from '@/lib/schemas';

describe('sourceCitationSchema', () => {
  it('accepts valid source citation payload', () => {
    const parsed = sourceCitationSchema.parse({
      source_name: 'Binance OHLCV',
      source_type: 'market_data',
      timestamp: new Date().toISOString(),
      evidence_snippet: '30 daily candles used for trend context',
      relevance_score: 0.92,
    });

    expect(parsed.source_type).toBe('market_data');
  });

  it('rejects invalid relevance score', () => {
    expect(() =>
      sourceCitationSchema.parse({
        source_name: 'Bad source',
        source_type: 'derived',
        timestamp: new Date().toISOString(),
        evidence_snippet: 'invalid score',
        relevance_score: 1.2,
      })
    ).toThrow();
  });
});

describe('aiPredictionSchema', () => {
  it('requires structured source list', () => {
    expect(() =>
      aiPredictionSchema.parse({
        symbol: 'BTCUSDT',
        probability: 70,
        target_percentage: 2.4,
        direction: 'Bullish',
        logic: 'Breakout probability increased.',
        strategic_advice: 'נהל סיכון עם סטופ.',
        learning_context: 'הופעלה למידה מהעבר.',
        sources: ['legacy-string'],
      })
    ).toThrow();
  });
});
