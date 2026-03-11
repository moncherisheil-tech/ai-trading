import { z } from 'zod';

export const binanceKlineRowSchema = z.tuple([
  z.number(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
]);

export const binanceKlinesSchema = z.array(binanceKlineRowSchema);

export const fearGreedSchema = z.object({
  data: z.array(
    z.object({
      value: z.string().optional(),
      value_classification: z.string().optional(),
    })
  ).optional(),
});

export const sourceCitationSchema = z.object({
  source_name: z.string().min(1),
  source_type: z.enum(['market_data', 'sentiment', 'historical', 'derived']),
  timestamp: z.string().min(1),
  evidence_snippet: z.string().min(1),
  relevance_score: z.number().min(0).max(1),
});

export const aiPredictionSchema = z.object({
  symbol: z.string().min(1),
  probability: z.number().min(0).max(100),
  target_percentage: z.number(),
  direction: z.enum(['Bullish', 'Bearish', 'Neutral']),
  logic: z.string().min(1),
  strategic_advice: z.string().min(1),
  learning_context: z.string().min(1),
  sources: z.array(sourceCitationSchema).min(1),
});

export type BinanceKlineRow = z.infer<typeof binanceKlineRowSchema>;
export type AiPredictionPayload = z.infer<typeof aiPredictionSchema>;
