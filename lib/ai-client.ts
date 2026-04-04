import OpenAI from 'openai';
import Groq from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { APP_CONFIG } from '@/lib/config';
import { getAppSettings, resolveLlmTemperature } from '@/lib/db/app-settings';
import { getGeminiApiKey, getOpenAiApiKey, getRequiredGroqApiKey, getRequiredAnthropicApiKey } from '@/lib/env';
import { GEMINI_CANONICAL_PRO_MODEL_ID, resolveGeminiModel, withGeminiRateLimitRetry } from '@/lib/gemini-model';
import { ANTHROPIC_SONNET_MODEL, ANTHROPIC_SONNET_FALLBACK_SNAPSHOT } from '@/lib/anthropic-model';

/** Providers available via global app config (no Anthropic — it is expert-only). */
type ConfigProvider = 'gemini' | 'openai' | 'groq';

/** Full provider surface available for per-call overrides (e.g. MoE experts). */
export type LlmProvider = ConfigProvider | 'anthropic';

function resolveProvider(): ConfigProvider {
  const provider = APP_CONFIG.aiProvider;
  if (provider === 'gemini' || provider === 'openai' || provider === 'groq') {
    return provider;
  }
  return 'gemini';
}

function assertLiveModeEnabled(): void {
  if (!APP_CONFIG.isLiveMode) {
    throw new Error('AI live mode is disabled. Set IS_LIVE_MODE=true to call external AI providers.');
  }
}

export async function generateLiveText(params: {
  prompt: string;
  /** Per-call provider override. When omitted the global APP_CONFIG.aiProvider is used. */
  provider?: LlmProvider;
  systemInstruction?: string;
  maxOutputTokens?: number;
  temperature?: number;
  locale?: 'he' | 'en';
}): Promise<string> {
  assertLiveModeEnabled();
  const provider: LlmProvider = params.provider ?? resolveProvider();
  const maxOutputTokens = params.maxOutputTokens ?? 500;
  const settings = await getAppSettings();
  const temperature = params.temperature ?? resolveLlmTemperature(settings);
  const forceHebrew = params.locale === 'he';
  const localeDirective = 'CRITICAL: You MUST answer in Hebrew. Do not use English.';
  const systemInstruction = forceHebrew
    ? [params.systemInstruction, localeDirective].filter(Boolean).join('\n\n')
    : params.systemInstruction;
  const prompt = forceHebrew ? `${params.prompt}\n\n${localeDirective}` : params.prompt;

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: getOpenAiApiKey() });
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const completion = await client.chat.completions.create({
      model,
      messages: [
        ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
        { role: 'user' as const, content: prompt },
      ],
      temperature,
      max_tokens: maxOutputTokens,
    });
    return (completion.choices?.[0]?.message?.content || '').trim();
  }

  if (provider === 'groq') {
    const client = new Groq({ apiKey: getRequiredGroqApiKey() });
    const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
    const completion = await client.chat.completions.create({
      model,
      messages: [
        ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
        { role: 'user' as const, content: prompt },
      ],
      temperature,
      max_tokens: maxOutputTokens,
    });
    return (completion.choices?.[0]?.message?.content || '').trim();
  }

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: getRequiredAnthropicApiKey() });
    const systemToUse = systemInstruction ?? undefined;
    const buildRequest = (model: string) => ({
      model,
      max_tokens: maxOutputTokens,
      ...(systemToUse ? { system: systemToUse } : {}),
      messages: [{ role: 'user' as const, content: prompt }],
    });
    try {
      const message = await client.messages.create(buildRequest(ANTHROPIC_SONNET_MODEL));
      return (message.content[0]?.type === 'text' ? message.content[0].text : '').trim();
    } catch (primaryErr) {
      const isModelErr =
        primaryErr instanceof Error &&
        (primaryErr.message.includes('404') || primaryErr.message.toLowerCase().includes('not_found'));
      if (isModelErr) {
        const fallback = await client.messages.create(buildRequest(ANTHROPIC_SONNET_FALLBACK_SNAPSHOT));
        return (fallback.content[0]?.type === 'text' ? fallback.content[0].text : '').trim();
      }
      throw primaryErr;
    }
  }

  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const selected = resolveGeminiModel(APP_CONFIG.primaryModel || GEMINI_CANONICAL_PRO_MODEL_ID);
  const model = genAI.getGenerativeModel(
    {
      model: selected.model,
    },
    selected.requestOptions
  );
  const geminiPrompt = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;
  const response = await withGeminiRateLimitRetry(() =>
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: geminiPrompt }] }],
      generationConfig: { temperature, maxOutputTokens },
    })
  );
  return (response.response.text() || '').trim();
}

