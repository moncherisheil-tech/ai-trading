import { z } from 'zod';

/** Single kline row: Binance returns 12 elements; we use indices 0–5 (time, O, H, L, C, V). Accept 6–30 elements. */
export const binanceKlineRowSchema = z.array(z.unknown()).min(6).max(30);

/** Price history: up to 1000 candles (production limit). */
export const binanceKlinesSchema = z.array(binanceKlineRowSchema).min(0).max(1000);

export const fearGreedSchema = z.object({
  data: z.array(
    z.object({
      value: z.string().optional(),
      value_classification: z.string().optional(),
    })
  ).optional(),
});

/** Normalize AI output: 85 → 0.85; values >100 clamp to 1; then clamp to [0,1]. */
function normalizeRelevanceScore(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  let x = n;
  if (x > 1) {
    if (x <= 100) x = x / 100;
    else x = 1;
  }
  return Math.max(0, Math.min(1, x));
}

export const sourceCitationSchema = z.object({
  source_name: z.string().min(1),
  source_type: z.string().catch('derived'),
  timestamp: z.string().nullable().optional(),
  evidence_snippet: z.string().min(1),
  relevance_score: z.preprocess(normalizeRelevanceScore, z.number().min(0).max(1).optional()),
});

/** Risk level as output by the Quantitative AI engine. */
export const riskLevelSchema = z.enum(['High', 'Medium', 'Low']);

/** Strict AI prediction schema (full validation) — institutional-grade Quant engine output. */
export const aiPredictionSchema = z.object({
  symbol: z.string().min(1),
  probability: z.number().min(0).max(100),
  target_percentage: z.number(),
  direction: z.enum(['Bullish', 'Bearish', 'Neutral']),
  risk_level: riskLevelSchema.optional(),
  logic: z.string().min(1),
  strategic_advice: z.string().min(1),
  learning_context: z.string().min(1),
  sources: z.array(sourceCitationSchema).min(0).max(1000),
  tactical_opinion_he: z.string().optional(),
});

/** Partial schema with defaults for autonomous repair when AI returns incomplete JSON. */
export const aiPredictionPartialSchema = aiPredictionSchema.partial().extend({
  symbol: z.string().min(1).default('UNKNOWN'),
  probability: z.number().min(0).max(100).default(50),
  target_percentage: z.number().default(0),
  direction: z.enum(['Bullish', 'Bearish', 'Neutral']).default('Neutral'),
  risk_level: riskLevelSchema.optional(),
  logic: z.string().min(1).default('Partial data recovery.'),
  strategic_advice: z.string().min(1).default('Verify prediction manually.'),
  learning_context: z.string().min(1).default('Recovered from partial response.'),
  sources: z.array(sourceCitationSchema).min(0).max(1000).default([]).catch([]),
});

export type BinanceKlineRow = z.infer<typeof binanceKlineRowSchema>;
export type AiPredictionPayload = z.infer<typeof aiPredictionSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
