import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { APP_CONFIG } from '@/lib/config';
import { getGeminiApiKey, getOpenAiApiKey, getRequiredGroqApiKey } from '@/lib/env';
import { resolveGeminiModel, withGeminiRateLimitRetry } from '@/lib/gemini-model';

type Provider = 'gemini' | 'openai' | 'groq';

function resolveProvider(): Provider {
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
  systemInstruction?: string;
  maxOutputTokens?: number;
  temperature?: number;
  locale?: 'he' | 'en';
}): Promise<string> {
  assertLiveModeEnabled();
  const provider = resolveProvider();
  const maxOutputTokens = params.maxOutputTokens ?? 500;
  const temperature = params.temperature ?? 0.3;
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

  const genAI = new GoogleGenerativeAI(getGeminiApiKey());
  const selected = resolveGeminiModel(APP_CONFIG.primaryModel || 'gemini-2.5-flash');
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

