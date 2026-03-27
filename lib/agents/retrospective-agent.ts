import { GoogleGenerativeAI } from '@google/generative-ai';
import { APP_CONFIG } from '@/lib/config';
import { GEMINI_DEFAULT_FLASH_MODEL_ID, resolveGeminiModel } from '@/lib/gemini-model';
import { getGeminiApiKey } from '@/lib/env';
import { queryAcademyKnowledge } from '@/lib/vector-db';
import type { TradeExecutionRow } from '@/lib/db/execution-learning';
import { insertLearnedInsight } from '@/lib/db/execution-learning';
import { generateSafeId } from '@/lib/utils';

export interface AlphaSignalLike {
  id?: string;
  symbol?: string;
  rationale?: string;
  shortTermOutlook?: { rationale?: string; signal?: string; probability?: number };
  swingOutlook?: { rationale?: string; signal?: string; probability?: number };
}

export async function runRetrospectiveAgent(input: {
  trade: TradeExecutionRow;
  alphaSignal?: AlphaSignalLike | null;
}) {
  const { trade, alphaSignal } = input;
  if (trade.status !== 'CLOSED' && trade.status !== 'FAILED') {
    return { success: false, error: 'Retrospective requires a closed or failed trade.' as const };
  }

  const negative = (trade.pnl ?? 0) < 0;
  const seedReason = negative ? 'loss' : 'missed-alpha';
  const query = [
    `Trade ${trade.symbol} ${trade.side}`,
    `pnl ${trade.pnl ?? 0}`,
    alphaSignal?.rationale ?? '',
    alphaSignal?.shortTermOutlook?.rationale ?? '',
    alphaSignal?.swingOutlook?.rationale ?? '',
    'false breakout low volume fake momentum risk management stop loss slippage',
  ]
    .filter(Boolean)
    .join(' | ');

  let academyHits: Array<{ text: string; reference?: string | null; id?: string | null }> = [];
  try {
    academyHits = await queryAcademyKnowledge(query, 5);
  } catch (err) {
    console.error('[retrospective-agent] queryAcademyKnowledge failed:', err);
  }
  const academyContext = academyHits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');

  let failureReason = seedReason;
  let academyReference: string | null = academyHits[0]?.reference || academyHits[0]?.id || null;

  try {
    const genAI = new GoogleGenerativeAI(getGeminiApiKey());
    const selected = resolveGeminiModel(APP_CONFIG.primaryModel || GEMINI_DEFAULT_FLASH_MODEL_ID);
    const model = genAI.getGenerativeModel({ model: selected.model }, selected.requestOptions);
    const prompt = `
You are a quantitative trading retrospective analyst.
Given a closed trade and alpha signal context, infer the most likely failure reason.
Return strict JSON:
{"failureReason":"...","academyReference":"...","adjustmentApplied":true|false}

trade:
${JSON.stringify(trade)}

alphaSignal:
${JSON.stringify(alphaSignal ?? null)}

academy_context:
${academyContext || 'No academy matches found.'}
`;
    const out = await model.generateContent(prompt);
    const text = out.response.text().trim();
    const maybeJson = text.match(/\{[\s\S]*\}/)?.[0] ?? '{}';
    const parsed = JSON.parse(maybeJson) as {
      failureReason?: string;
      academyReference?: string;
      adjustmentApplied?: boolean;
    };
    if (parsed.failureReason?.trim()) failureReason = parsed.failureReason.trim();
    if (parsed.academyReference?.trim()) academyReference = parsed.academyReference.trim();
    const saved = await insertLearnedInsight({
      id: generateSafeId(),
      tradeId: trade.id,
      failureReason,
      academyReference,
      adjustmentApplied: Boolean(parsed.adjustmentApplied),
    });
    return { success: true as const, insight: saved };
  } catch (err) {
    console.error('[retrospective-agent] failed:', err);
    const saved = await insertLearnedInsight({
      id: generateSafeId(),
      tradeId: trade.id,
      failureReason,
      academyReference,
      adjustmentApplied: false,
    });
    return { success: saved != null, insight: saved, error: err instanceof Error ? err.message : 'retrospective-failed' };
  }
}
