#!/usr/bin/env tsx
/**
 * Smoke test: Tri-Core Gemini Weekly/Long prompt + JSON parse into AnalysisResult.
 *
 * Usage (from project root):
 *   npx tsx bin/test-gemini.ts
 *
 * Requires GEMINI_API_KEY (or GOOGLE_API_KEY) in .env — same as production.
 */
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { analysisResultSchema, type AnalysisResult } from '../lib/alpha-engine';
import { parseJsonObjectFromAiResponse } from '../lib/gemini-json-clean';
import { getGeminiApiKey } from '../lib/env';
import { GEMINI_DEFAULT_FLASH_MODEL_ID, resolveGeminiModel, withGeminiRateLimitRetry } from '../lib/gemini-model';

const RAW_JSON_SYSTEM_EN = [
  'Return RAW JSON only.',
  'DO NOT use markdown code block wrappers like ```json or ``` — output the JSON object directly with no fences.',
  'No prose before or after the JSON.',
].join(' ');

function buildProductionPrompt(symbol: string, price: number, macroLine: string, deepMemoryBlock: string): string {
  return `אתה אנליסט מאקרו ו-Deep Memory.

CRITICAL OUTPUT RULES (repeat for compliance):
- Return RAW JSON only — a single JSON object, nothing else.
- DO NOT use markdown code block wrappers like \`\`\`json or \`\`\`.
- Do not add explanations before or after the JSON.

Schema (example shape only):
{"weekly":{"direction":"Long","winProbability":70,"rationaleHebrew":"טקסט בעברית"},"long":{"direction":"Short","winProbability":65,"rationaleHebrew":"טקסט בעברית"}}

חובה: direction הוא המחרוזת Long או Short בלבד (באנגלית). winProbability מספר 0-100. rationaleHebrew בעברית.
סמל ${symbol}, מחיר ${price}.
מאקרו: ${macroLine}
הקשר Deep Memory (עסקאות דומות): ${deepMemoryBlock}
שבועי=אופק Weekly, long=אופק ארוך (Position).`;
}

async function main(): Promise<void> {
  const apiKey = getGeminiApiKey();
  const primary = process.env.GEMINI_MODEL_PRIMARY || GEMINI_DEFAULT_FLASH_MODEL_ID;
  const selected = resolveGeminiModel(primary);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel(
    {
      model: selected.model,
      systemInstruction: [
        'You are an institutional macro and deep-memory analyst for crypto.',
        RAW_JSON_SYSTEM_EN,
        'Emit one JSON object with nested weekly and long objects as specified in the user message.',
      ].join(' '),
    },
    selected.requestOptions
  );

  const symbol = 'BTCUSDT';
  const price = 95_000;
  const macroLine = 'DXY: probe; BTC dom 55%; F&G 50';
  const deepMemoryBlock = 'אין עסקאות דומות ב-Pinecone.';
  const prompt = buildProductionPrompt(symbol, price, macroLine, deepMemoryBlock);

  const result = await withGeminiRateLimitRetry(() =>
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 4096 },
    })
  );

  const rawText = result.response.text() ?? '';
  const jsonTry = parseJsonObjectFromAiResponse(rawText);
  if (!jsonTry.ok) {
    console.error('RAW GEMINI RESPONSE:', rawText);
    throw new Error(`JSON.parse failed: ${String(jsonTry.error)}`);
  }

  const parsed = analysisResultSchema.safeParse(jsonTry.value);
  if (!parsed.success) {
    console.error('RAW GEMINI RESPONSE:', rawText);
    throw new Error(`Schema validation failed: ${parsed.error.message}`);
  }

  const data: AnalysisResult = parsed.data;
  console.log('OK — AnalysisResult validated:', JSON.stringify(data, null, 2));
  console.log('Model:', selected.model);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
