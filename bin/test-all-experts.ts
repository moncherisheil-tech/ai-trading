#!/usr/bin/env tsx
/**
 * Cross-model smoke test: Groq (hourly shape), Anthropic (daily shape), Gemini (weekly+long).
 * Prints "Model: OK" only when JSON parses and matches the shared Tri-Core schemas.
 *
 *   npx tsx bin/test-all-experts.ts
 *
 * Requires GROQ_API_KEY, ANTHROPIC_API_KEY (or CLAUDE_API_KEY), GEMINI_API_KEY (or GOOGLE_API_KEY).
 */
import 'dotenv/config';
import {
  analysisResultSchema,
  callAnthropicDaily,
  callGeminiWeeklyLong,
  callGroqHourly,
  coreSignalSchema,
  triCoreAnthropicOutputIsLlmParsed,
  triCoreGeminiOutputIsLlmParsed,
  triCoreGroqOutputIsLlmParsed,
} from '../lib/alpha-engine';
import { ANTHROPIC_MODEL_CANDIDATES, ANTHROPIC_SONNET_MODEL } from '../lib/anthropic-model';
import { GEMINI_DEFAULT_FLASH_MODEL_ID } from '../lib/gemini-model';
import { GROQ_DEFAULT_MODEL, resolveGroqModel } from '../lib/groq-model';

const SYMBOL = 'BTCUSDT';
const PRICE = 95_000;

const STUB_ORDER_BOOK = 'Bid-heavy: top depth favors bids vs asks. Imbalance ~55/45 bid. Symbol BTCUSDT.';
const STUB_LEVIATHAN = 'Exchange netflow neutral; large wallet movements muted.';
const STUB_WHALE = JSON.stringify({ status: 'ok', netExchangeFlowUsd: -1_200_000, severeInflowsToExchanges: 0 });
const STUB_MACRO = 'DXY: range; BTC dom 54%; F&G 52';
const STUB_MEMORY = 'אין עסקאות דומות ב-Pinecone.';

async function main(): Promise<void> {
  console.log('Configured models:');
  console.log('  Anthropic primary:', ANTHROPIC_SONNET_MODEL, '| candidates:', ANTHROPIC_MODEL_CANDIDATES.join(', '));
  console.log('  Gemini:', process.env.GEMINI_MODEL_PRIMARY || GEMINI_DEFAULT_FLASH_MODEL_ID);
  console.log('  Groq:', resolveGroqModel(), GROQ_DEFAULT_MODEL === resolveGroqModel() ? '(default)' : '(from GROQ_MODEL)');

  const groqResult = await callGroqHourly(STUB_ORDER_BOOK, SYMBOL, PRICE);
  const groqParsed = coreSignalSchema.safeParse(groqResult);
  if (!groqParsed.success || !triCoreGroqOutputIsLlmParsed(groqParsed.data)) {
    console.error('Groq: FAIL', groqParsed.success ? '(fallback path, not parsed LLM JSON)' : groqParsed.error.flatten());
    process.exit(1);
  }
  console.log('Groq: OK');

  const geminiResult = await callGeminiWeeklyLong(STUB_MACRO, STUB_MEMORY, SYMBOL, PRICE);
  const geminiParsed = analysisResultSchema.safeParse(geminiResult);
  if (!geminiParsed.success || !triCoreGeminiOutputIsLlmParsed(geminiParsed.data)) {
    console.error('Gemini: FAIL', geminiParsed.success ? '(fallback path, not parsed LLM JSON)' : geminiParsed.error.flatten());
    process.exit(1);
  }
  console.log('Gemini: OK');

  const anthropicResult = await callAnthropicDaily(STUB_LEVIATHAN, STUB_WHALE, SYMBOL, PRICE);
  const anthropicParsed = coreSignalSchema.safeParse(anthropicResult);
  if (!anthropicParsed.success || !triCoreAnthropicOutputIsLlmParsed(anthropicParsed.data)) {
    console.error(
      'Anthropic: FAIL',
      anthropicParsed.success ? '(fallback path, not parsed LLM JSON)' : anthropicParsed.error.flatten()
    );
    process.exit(1);
  }
  console.log('Anthropic: OK');

  console.log('\nSample (trimmed):', {
    groq: { direction: groqParsed.data.direction, winProbability: groqParsed.data.winProbability },
    gemini: {
      weekly: { direction: geminiParsed.data.weekly.direction, winProbability: geminiParsed.data.weekly.winProbability },
      long: { direction: geminiParsed.data.long.direction, winProbability: geminiParsed.data.long.winProbability },
    },
    anthropic: { direction: anthropicParsed.data.direction, winProbability: anthropicParsed.data.winProbability },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
