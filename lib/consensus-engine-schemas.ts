/**
 * PHASE 4 FIX: Strict Zod schemas for all 7 MoE expert outputs.
 *
 * VULNERABILITY: callGeminiJson() previously ended with `return JSON.parse(jsonStr) as T`.
 * This is a TypeScript lie — it's a cast, not a validation. Gemini or Anthropic can return:
 *   {"tech_score": "very bullish", "tech_logic": null}
 * → tech_score becomes NaN in consensus math, silently poisoning the final_confidence.
 *
 * FIX: After JSON.parse(), run the result through the appropriate Zod schema.
 * On failure: retry once (transient hallucination). If retry also fails: throw a
 * structured error that aborts the trade cycle for this expert. The expert's
 * fallback (is_fallback=true, score=50) is then used instead of garbage data.
 *
 * Integration pattern:
 *   import { validateExpertOutput, ExpertSchema } from '@/lib/consensus-engine-schemas';
 *   const raw = JSON.parse(jsonStr);
 *   const validated = validateExpertOutput(raw, ExpertSchema.technician, 'Technician');
 *   // validated is type-safe or throws ZodExpertValidationError
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Enforces 0–100 numeric score. Coerces strings like "72" → 72. */
const scoreField = z
  .union([z.number(), z.string()])
  .transform((val) => {
    const n = typeof val === 'number' ? val : parseFloat(String(val));
    if (!Number.isFinite(n)) throw new z.ZodError([{
      code: 'custom',
      message: `Score must be a finite number, got: ${JSON.stringify(val)}`,
      path: [],
    }]);
    return Math.max(0, Math.min(100, n));
  });

/** Enforces non-empty Hebrew/English logic string. Truncates at 1000 chars. */
const logicField = z
  .string()
  .min(1, 'Logic field must not be empty')
  .transform((s) => s.slice(0, 1000));

// ---------------------------------------------------------------------------
// Expert schemas
// ---------------------------------------------------------------------------

export const TechnicianSchema = z.object({
  tech_score: scoreField,
  tech_logic: logicField,
});
export type TechnicianOutput = z.infer<typeof TechnicianSchema> & { is_fallback: boolean };

export const RiskManagerSchema = z.object({
  risk_score: scoreField,
  risk_logic: logicField,
});
export type RiskManagerOutput = z.infer<typeof RiskManagerSchema> & { is_fallback: boolean };

export const PsychologistSchema = z.object({
  psych_score: scoreField,
  psych_logic: logicField,
});
export type PsychologistOutput = z.infer<typeof PsychologistSchema> & { is_fallback: boolean };

export const MacroSchema = z.object({
  macro_score: scoreField,
  macro_logic: logicField,
});
export type MacroOutput = z.infer<typeof MacroSchema> & { is_fallback: boolean };

export const OnChainSchema = z.object({
  onchain_score: scoreField,
  onchain_logic: logicField,
});
export type OnChainOutput = z.infer<typeof OnChainSchema> & { is_fallback: boolean };

export const DeepMemorySchema = z.object({
  deep_memory_score: scoreField,
  deep_memory_logic: logicField,
});
export type DeepMemoryOutput = z.infer<typeof DeepMemorySchema> & { is_fallback: boolean };

export const ContrarianSchema = z.object({
  contrarian_confidence: scoreField,
  trap_type: z.enum(['none', 'bull_trap', 'bear_trap', 'liquidity_trap'], {
    errorMap: () => ({ message: 'trap_type must be one of: none, bull_trap, bear_trap, liquidity_trap' }),
  }),
  attack_on_consensus_he: z.string().min(1).transform((s) => s.slice(0, 1000)),
  trap_hypothesis_he: z.string().min(1).transform((s) => s.slice(0, 1000)),
});
export type ContrarianOutput = z.infer<typeof ContrarianSchema> & { is_fallback: boolean };

// Union type for all expert schemas
export const ExpertSchema = {
  technician: TechnicianSchema,
  risk: RiskManagerSchema,
  psych: PsychologistSchema,
  macro: MacroSchema,
  onchain: OnChainSchema,
  deepMemory: DeepMemorySchema,
  contrarian: ContrarianSchema,
} as const;

export type ExpertSchemaKey = keyof typeof ExpertSchema;

// ---------------------------------------------------------------------------
// Structured validation error
// ---------------------------------------------------------------------------

export class ZodExpertValidationError extends Error {
  constructor(
    public readonly expert: string,
    public readonly zodError: z.ZodError,
    public readonly rawInput: unknown,
  ) {
    super(
      `[ConsensusEngine] Expert "${expert}" output failed Zod validation: ` +
      zodError.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
    );
    this.name = 'ZodExpertValidationError';
  }
}

// ---------------------------------------------------------------------------
// Main validation function with retry-once logic
//
// Usage in callGeminiJson / callGroqJson:
//
//   const parsed = JSON.parse(jsonStr);
//   return validateExpertOutput(parsed, TechnicianSchema, 'Technician');
//
// On the second call (retry), pass isRetry=true. If it fails again,
// ZodExpertValidationError is thrown and the caller must use the fallback.
// ---------------------------------------------------------------------------

export function validateExpertOutput<T extends z.ZodTypeAny>(
  raw: unknown,
  schema: T,
  expertName: string,
  isRetry = false,
): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data;
  }

  if (!isRetry) {
    // Log for diagnostics but let caller retry
    console.warn(
      `[ConsensusEngine] Zod validation failed for "${expertName}" (will retry): ` +
      result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') +
      ` | Raw: ${JSON.stringify(raw).slice(0, 200)}`
    );
    throw new ZodExpertValidationError(expertName, result.error, raw);
  }

  // Second failure after retry — throw fatal validation error
  console.error(
    `[ConsensusEngine] FATAL: Zod validation failed for "${expertName}" after retry. ` +
    `Aborting trade cycle for this expert. ` +
    result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
  );
  throw new ZodExpertValidationError(expertName, result.error, raw);
}

// ---------------------------------------------------------------------------
// Wrapper for the LLM call-and-validate pattern
//
// Drop-in replacement for the raw JSON.parse(jsonStr) cast pattern:
//
//   // OLD (vulnerable):
//   return JSON.parse(jsonStr) as ExpertTechnicianOutput;
//
//   // NEW (hardened):
//   return await parseAndValidateExpertJson(
//     jsonStr,
//     TechnicianSchema,
//     'Technician',
//     fallbackValue,
//     retryFn,
//   );
// ---------------------------------------------------------------------------

export async function parseAndValidateExpertJson<T extends z.ZodTypeAny>(
  jsonStr: string,
  schema: T,
  expertName: string,
  fallback: z.infer<T>,
  retryFn: () => Promise<string>,
): Promise<z.infer<T>> {
  let raw: unknown;

  // Attempt 1: Parse and validate
  try {
    raw = JSON.parse(jsonStr);
  } catch (parseErr) {
    console.warn(`[ConsensusEngine] JSON.parse failed for "${expertName}" (attempt 1): ${parseErr}`);
    raw = null;
  }

  const result1 = schema.safeParse(raw);
  if (result1.success) return result1.data;

  console.warn(
    `[ConsensusEngine] Zod failed for "${expertName}" (attempt 1), retrying: ` +
    result1.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
  );

  // Attempt 2: Retry the LLM call once
  let retryRaw: unknown;
  try {
    const retryJsonStr = await retryFn();
    retryRaw = JSON.parse(retryJsonStr);
  } catch (retryErr) {
    console.error(
      `[ConsensusEngine] Retry JSON.parse failed for "${expertName}": ${retryErr}. ` +
      `Using fallback (is_fallback=true).`
    );
    return fallback;
  }

  const result2 = schema.safeParse(retryRaw);
  if (result2.success) return result2.data;

  // Both attempts failed — abort this expert, use fallback
  console.error(
    `[ConsensusEngine] ABORT: "${expertName}" produced invalid JSON twice. ` +
    `Zod errors: ${result2.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}. ` +
    `Falling back to neutral score. Trade cycle continues with degraded expert.`
  );
  return fallback;
}

// ---------------------------------------------------------------------------
// Type-safe fallback factories for each expert
// ---------------------------------------------------------------------------

export const EXPERT_FALLBACKS = {
  technician: { tech_score: 50, tech_logic: 'הנתונים אינם זמינים כרגע. ממשיכים במשקל ניטרלי.', is_fallback: true } satisfies TechnicianOutput,
  risk:       { risk_score: 50, risk_logic: 'הנתונים אינם זמינים כרגע. ממשיכים במשקל ניטרלי.', is_fallback: true } satisfies RiskManagerOutput,
  psych:      { psych_score: 50, psych_logic: 'הנתונים אינם זמינים כרגע. ממשיכים במשקל ניטרלי.', is_fallback: true } satisfies PsychologistOutput,
  macro:      { macro_score: 50, macro_logic: 'הנתונים אינם זמינים כרגע. ממשיכים במשקל ניטרלי.', is_fallback: true } satisfies MacroOutput,
  onchain:    { onchain_score: 50, onchain_logic: 'הנתונים אינם זמינים כרגע. ממשיכים במשקל ניטרלי.', is_fallback: true } satisfies OnChainOutput,
  deepMemory: { deep_memory_score: 50, deep_memory_logic: 'הנתונים אינם זמינים כרגע. ממשיכים במשקל ניטרלי.', is_fallback: true } satisfies DeepMemoryOutput,
  contrarian: {
    contrarian_confidence: 0,
    trap_type: 'none' as const,
    attack_on_consensus_he: 'הנתונים אינם זמינים כרגע. ממשיכים במשקל ניטרלי.',
    trap_hypothesis_he: 'ללא השערת מלכודת.',
    is_fallback: true,
  } satisfies ContrarianOutput,
} as const;
