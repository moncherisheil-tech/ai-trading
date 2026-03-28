import { z } from 'zod';

const themeSchema = z.enum(['dark', 'light', 'deep-sea']);
const refreshSchema = z.union([z.literal(1), z.literal(5), z.literal(15)]);
const executionModeSchema = z.enum(['PAPER', 'LIVE']);
const riskToleranceSchema = z.enum(['strict', 'moderate', 'aggressive']);

export const appSettingsFormSchema = z.object({
  trading: z.object({
    defaultTradeSizeUsd: z.coerce.number().min(10).max(1_000_000),
    maxOpenPositions: z.coerce.number().int().min(1).max(100),
    maxSlippagePct: z.coerce.number().min(0).max(100),
  }),
  risk: z.object({
    defaultStopLossPct: z.coerce.number().min(0).max(100),
    defaultTakeProfitPct: z.coerce.number().min(0).max(100),
    defaultPositionSizeUsd: z.coerce.number().min(10).max(1_000_000),
    globalMaxExposurePct: z.coerce.number().min(0).max(100),
    singleAssetConcentrationLimitPct: z.coerce.number().min(0).max(100),
    atrMultiplierTp: z.coerce.number().min(0.5).max(20),
    atrMultiplierSl: z.coerce.number().min(0.5).max(20),
    riskToleranceLevel: riskToleranceSchema.optional(),
  }),
  scanner: z.object({
    minVolume24hUsd: z.coerce.number().min(0).max(100_000_000),
    minPriceChangePctForGem: z.coerce.number().min(0).max(100),
    aiConfidenceThreshold: z.coerce.number().min(0).max(100),
  }),
  neural: z
    .object({
      moeConfidenceThreshold: z.coerce.number().min(50).max(95),
      llmTemperature: z.coerce.number().min(0).max(2),
      ragEnabled: z.boolean(),
      autoPostMortemEnabled: z.boolean(),
    })
    .passthrough(),
  notifications: z.object({
    dailyPulseReport: z.boolean(),
    riskCriticalAlerts: z.boolean(),
    newEliteGemDetected: z.boolean(),
  }),
  system: z.object({
    telegramNotifications: z.boolean(),
    soundAlerts: z.boolean(),
    theme: themeSchema,
    dataRefreshIntervalMinutes: refreshSchema,
    telegramBotToken: z.string().max(4096).optional(),
    telegramChatId: z.string().max(32).optional(),
  }),
  execution: z.object({
    masterSwitchEnabled: z.boolean(),
    mode: executionModeSchema,
    minConfidenceToExecute: z.coerce.number().min(0).max(100),
    goLiveSafetyAcknowledged: z.boolean(),
  }),
});

export type AppSettingsFormValues = z.infer<typeof appSettingsFormSchema>;
