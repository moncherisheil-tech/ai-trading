import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { getGroqApiKey } from '@/lib/env';

export const dynamic = 'force-dynamic';

async function callAnthropic(): Promise<{ ok: boolean; rawText: string }> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, rawText: 'ANTHROPIC_API_KEY/CLAUDE_API_KEY missing' };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
      max_tokens: 80,
      messages: [{ role: 'user', content: 'Reply with exactly one short line: ANTHROPIC_OK' }],
    }),
    cache: 'no-store',
  });

  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, rawText: `HTTP ${res.status}: ${raw.slice(0, 500)}` };
  }
  return { ok: true, rawText: raw.slice(0, 1200) };
}

async function callGroq(): Promise<{ ok: boolean; rawText: string }> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
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

export async function GET(): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Debug endpoint disabled in production.' }, { status: 403 });
  }

  const [anthropic, groq] = await Promise.all([callAnthropic(), callGroq()]);

  if (anthropic.ok) console.log('[debug/test-llms] Anthropic raw success:', anthropic.rawText);
  if (groq.ok) console.log('[debug/test-llms] Groq raw success:', groq.rawText);

  return NextResponse.json({
    ok: anthropic.ok && groq.ok,
    timestamp: new Date().toISOString(),
    anthropic,
    groq,
  });
}
