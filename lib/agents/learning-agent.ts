import fs from 'fs';
import path from 'path';
import { StrategyInsight } from '@/lib/schemas/strategy-insight';
import { appendStrategyInsights } from '@/lib/db/strategy-repository';
import type { BacktestLogEntry } from '@/lib/db/backtest-repository';
import { ANTHROPIC_HAIKU_MODEL } from '@/lib/anthropic-model';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getRequiredAnthropicApiKey, getGeminiApiKey } from '@/lib/env';
import { resolveGeminiModel } from '@/lib/gemini-model';

const BACKTEST_LOG_PATH = path.join(process.cwd(), 'backtests.jsonl');

async function loadCriticalBacktests(): Promise<BacktestLogEntry[]> {
  try {
    const raw = await fs.promises.readFile(BACKTEST_LOG_PATH, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    const entries: BacktestLogEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as BacktestLogEntry;
        if (parsed.requires_deep_analysis) {
          entries.push(parsed);
        }
      } catch {
        // ignore malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function getClaudeApiKey(): string {
  return getRequiredAnthropicApiKey();
}

function extractJsonFromText(text: string): string {
  const trimmed = (text || '').trim();
  let str = trimmed;
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*\n?/i, '').replace(/(?:\r?\n)?\s*```\s*$/, '').trim();
  }
  const start = str.indexOf('[');
  const end = str.lastIndexOf(']') + 1;
  if (start >= 0 && end > start) return str.slice(start, end);
  return str;
}

async function callClaudeForInsights(backtests: BacktestLogEntry[]): Promise<StrategyInsight[]> {
  if (!backtests.length) return [];

  const compactCases = backtests.map((b) => ({
    symbol: b.symbol,
    predicted_direction: b.predicted_direction,
    entry_price: b.entry_price,
    current_price: b.current_price,
    price_diff_pct: b.price_diff_pct,
    absolute_error_pct: b.absolute_error_pct,
    outcome_label: b.outcome_label,
    evaluated_at: b.evaluated_at,
    sentiment_score: b.sentiment_score,
    market_narrative: b.market_narrative,
  }));

  const userPrompt = `
You are a quantitative research assistant. You receive a list of failed or high-error crypto predictions.
Each item may include: symbol, predicted_direction, entry_price, current_price, price_diff_pct, absolute_error_pct, outcome_label, evaluated_at, and when available: sentiment_score (-1 to 1) and market_narrative (news-based mood at prediction time).

Your task:
- Identify recurring patterns or mistakes.
- Keep domains separate: attribute errors to "technical / price action" only when entry_price, current_price, or direction mismatch support it; attribute to "sentiment / headlines" only when sentiment_score or market_narrative supports it. Do not explain technical misses using headline mood alone, or vice versa.
- Pay special attention to sentiment: e.g. when sentiment_score was strongly positive (FOMO) or negative (panic) but the model predicted the opposite or ignored it—flag patterns like "The model ignores FOMO/panic news" or "Predictions contradict strong news-driven sentiment."
- For each clear pattern, produce ONE strategy insight with:
  - pattern_summary: short description of the pattern (in Hebrew).
  - actionable_rule: concrete rule to avoid this mistake (in Hebrew).
  - confidence_score: number between 0 and 1.

Respond ONLY with a JSON array of objects matching:
[{ "pattern_summary": string, "actionable_rule": string, "confidence_score": number }]

Failed / high-error cases:
${JSON.stringify(compactCases, null, 2)}
`;

  const parseInsights = (raw: string): { pattern_summary: string; actionable_rule: string; confidence_score: number }[] => {
    try {
      const parsed = JSON.parse(extractJsonFromText(raw)) as { pattern_summary: string; actionable_rule: string; confidence_score: number }[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  let rawInsights: { pattern_summary: string; actionable_rule: string; confidence_score: number }[] = [];
  try {
    const apiKey = getClaudeApiKey();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_HAIKU_MODEL,
        max_tokens: 1024,
        temperature: 0.1,
        system:
          'You are a disciplined quantitative trading research assistant. Always respond with strict JSON, no prose.',
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { content?: { type: string; text?: string }[] };
      const text = data.content?.[0]?.text?.trim() ?? '';
      rawInsights = text ? parseInsights(text) : [];
    }
  } catch {
    rawInsights = [];
  }

  if (rawInsights.length === 0) {
    try {
      const genAI = new GoogleGenerativeAI(getGeminiApiKey());
      const selected = resolveGeminiModel(process.env.GEMINI_MODEL_PRIMARY || 'gemini-3-flash-preview');
      const model = genAI.getGenerativeModel(
        {
          model: selected.model,
        },
        selected.requestOptions
      );
      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `You are a disciplined quantitative trading research assistant. Always respond with strict JSON, no prose.\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
      });
      const text = response.response.text()?.trim() ?? '';
      rawInsights = text ? parseInsights(text) : [];
    } catch {
      rawInsights = [];
    }
  }

  const now = new Date().toISOString();
  const insights: StrategyInsight[] = rawInsights
    .filter(
      (i) =>
        i &&
        typeof i.pattern_summary === 'string' &&
        typeof i.actionable_rule === 'string' &&
        typeof i.confidence_score === 'number',
    )
    .map((i) => ({
      id: crypto.randomUUID(),
      pattern_summary: i.pattern_summary,
      actionable_rule: i.actionable_rule,
      confidence_score: i.confidence_score,
      created_at: now,
      status: 'pending',
    }));

  return insights;
}

export async function runLearningFromBacktests(): Promise<{ created: number }> {
  const criticalBacktests = await loadCriticalBacktests();
  if (!criticalBacktests.length) {
    return { created: 0 };
  }

  const insights = await callClaudeForInsights(criticalBacktests);
  if (!insights.length) {
    return { created: 0 };
  }

  await appendStrategyInsights(insights);
  return { created: insights.length };
}

