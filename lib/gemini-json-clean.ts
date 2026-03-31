/**
 * Normalize LLM text into a JSON object string: strip markdown fences, preamble,
 * and isolate the first balanced `{ ... }` when greedy matching fails.
 */
export function cleanJsonFromAiResponse(raw: string): string {
  let t = (raw || '').replace(/^\uFEFF/, '').trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    t = fenced[1].trim();
  } else {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }
  t = t.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const balanced = extractFirstBalancedJsonObject(t);
  if (balanced) return balanced;
  const greedyObject = t.match(/\{[\s\S]*\}/);
  if (greedyObject) return greedyObject[0];
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i >= 0 && j > i) return t.slice(i, j + 1);
  return t;
}

function extractFirstBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

export function parseJsonObjectFromAiResponse(raw: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  const cleaned = cleanJsonFromAiResponse(raw);
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (error) {
    return { ok: false, error };
  }
}
