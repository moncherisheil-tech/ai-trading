import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { ANTHROPIC_MODEL_CANDIDATES } from '@/lib/anthropic-model';

export const dynamic = 'force-dynamic';

async function callAnthropic(): Promise<{ ok: boolean; rawText: string; warning?: string }> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, rawText: 'ANTHROPIC_API_KEY/CLAUDE_API_KEY missing' };
  }

  let saw404Mismatch = false;
  let lastError = '';

  for (const modelName of ANTHROPIC_MODEL_CANDIDATES) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 80,
        messages: [{ role: 'user', content: 'Reply with exactly one short line: ANTHROPIC_OK' }],
      }),
      cache: 'no-store',
    });

    const raw = await res.text();
    if (res.ok) {
      return { ok: true, rawText: raw.slice(0, 1200) };
    }

    if (res.status === 429) {
      return { ok: true, rawText: 'QUOTA_REACHED_BUT_CONNECTED' };
    }

    if (res.status === 404) {
      saw404Mismatch = true;
      lastError = `HTTP 404 (${modelName}): ${raw.slice(0, 500)}`;
      continue;
    }

    return { ok: false, rawText: `HTTP ${res.status} (${modelName}): ${raw.slice(0, 500)}` };
  }

  if (saw404Mismatch) {
    return {
      ok: true,
      rawText: lastError || 'ANTHROPIC_MODEL_MISMATCH_BUT_KEY_WORKS',
      warning: 'ANTHROPIC_MODEL_MISMATCH_BUT_KEY_WORKS',
    };
  }

  return { ok: false, rawText: lastError || 'Anthropic request failed.' };
}

async function callGroq(): Promise<{ ok: boolean; rawText: string }> {
  const envVarName = 'GROQ_API_KEY';
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    console.error(`[debug/test-llms] Missing Groq API key; attempted env var: ${envVarName}`);
    return { ok: false, rawText: 'GROQ_API_KEY missing' };
  }

  const groq = new Groq({ apiKey });
  try {
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'Reply with exactly one short line: GROQ_OK' }],
      max_tokens: 40,
      temperature: 0,
    });
    const raw = completion.choices?.[0]?.message?.content?.trim() || '';
    return { ok: true, rawText: raw || '(empty text)' };
  } catch (error) {
    return {
      ok: false,
      rawText: error instanceof Error ? error.message : String(error),
    };
  }
}

async function callGemini(): Promise<{ ok: boolean; rawText: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, rawText: 'GEMINI_API_KEY missing' };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with GEMINI_OK' }] }],
      }),
      cache: 'no-store',
    }
  );
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, rawText: `HTTP ${res.status}: ${raw.slice(0, 500)}` };
  }
  return { ok: true, rawText: raw.slice(0, 1200) };
}

export async function GET(): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Debug endpoint disabled in production.' }, { status: 403 });
  }

  const [anthropic, groq, gemini] = await Promise.all([callAnthropic(), callGroq(), callGemini()]);

  const warnings = [anthropic.warning].filter((w): w is string => Boolean(w));

  if (anthropic.ok && groq.ok && gemini.ok) {
    return NextResponse.json({
      ok: true,
      status: 'SYSTEM STATUS: OPERATIONAL',
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  }

  return NextResponse.json(
    {
      ok: false,
      anthropic,
      groq,
      gemini,
    },
    { status: 503 }
  );
}
