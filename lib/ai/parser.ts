/**
 * Shared AI response → JSON parsing (triple-clean + structured logging on failure).
 */
import { cleanJsonFromAiResponse } from '@/lib/gemini-json-clean';

/**
 * 1. Strip markdown ```json / ``` fences and stray backticks.
 * 2. Trim whitespace and BOM.
 * 3. Isolate the first balanced `{ ... }` via cleanJsonFromAiResponse.
 */
export function tripleCleanJsonString(raw: string): string {
  let s = String(raw ?? '').replace(/^\uFEFF/, '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    s = fenced[1].trim();
  } else {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }
  s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  s = s.replace(/^[\s\n\r]+/, '').replace(/[\s\n\r]+$/, '');
  return cleanJsonFromAiResponse(s);
}

export type ParseAiJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown; cleaned: string };

/**
 * Parse JSON after triple-clean. On failure, logs the raw model output for debugging.
 */
export function parseAiJsonObject(raw: string, logLabel: string): ParseAiJsonResult {
  const cleaned = tripleCleanJsonString(raw);
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (error) {
    console.error(`[AI JSON parse failed] ${logLabel}`);
    console.error('[AI RAW RESPONSE]', raw);
    console.error('[AI CLEANED STRING]', cleaned.length > 8000 ? `${cleaned.slice(0, 8000)}…` : cleaned);
    return { ok: false, error, cleaned };
  }
}
