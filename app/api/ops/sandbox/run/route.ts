import { NextResponse } from 'next/server';
import { getDbAsync, saveDbAsync, type PredictionRecord } from '@/lib/db';
import { runConsensusEngine } from '@/lib/consensus-engine';
import {
  SANDBOX_CONSENSUS_INPUT,
  SANDBOX_LLM_RAW,
  SANDBOX_MOCK_PAYLOAD,
} from '@/lib/qa/sandbox-fixtures';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    const db = await getDbAsync();
    const latest = [...db]
      .sort((a, b) => new Date(b.prediction_date).getTime() - new Date(a.prediction_date).getTime())[0];

    const input = {
      ...SANDBOX_CONSENSUS_INPUT,
      current_price: latest?.entry_price ?? SANDBOX_CONSENSUS_INPUT.current_price,
    };

    const consensus = await runConsensusEngine(input, {
      moeConfidenceThreshold: 75,
      mockPayload: SANDBOX_MOCK_PAYLOAD,
    });

    const now = new Date().toISOString();
    const alphaSignal: PredictionRecord = {
      id: crypto.randomUUID(),
      symbol: input.symbol,
      prediction_date: now,
      predicted_direction: 'Bullish',
      probability: Math.round(consensus.final_confidence),
      target_percentage: 2.4,
      entry_price: input.current_price,
      status: 'qa_sandbox',
      model_name: 'qa-sandbox-mocked-board',
      logic: 'QA sandbox simulation completed through consensus engine with cached fixtures.',
      strategic_advice: 'Local QA only. No live execution.',
      learning_context: 'Sandbox run using cached DB context, cached Leviathan text, and pre-recorded LLM payloads.',
      final_confidence: consensus.final_confidence,
      master_insight_he: consensus.master_insight_he,
      reasoning_path: consensus.reasoning_path,
      tech_score: consensus.tech_score,
      risk_score: consensus.risk_score,
      psych_score: consensus.psych_score,
      macro_score: consensus.macro_score,
      onchain_score: consensus.onchain_score,
      deep_memory_score: consensus.deep_memory_score,
      macro_logic: consensus.macro_logic,
      onchain_logic: consensus.onchain_logic,
      deep_memory_logic: consensus.deep_memory_logic,
      bottom_line_he: 'Sandbox Alpha Signal נוצר בהצלחה ונשמר למסד הנתונים המקומי.',
      risk_level_he: 'סיכון בינוני',
      forecast_24h_he: 'תחזית סימולציה: +2.4%',
    };

    db.push(alphaSignal);
    await saveDbAsync(db);

    return NextResponse.json({
      ok: true,
      alphaSignalId: alphaSignal.id,
      consensus,
      llmRaw: SANDBOX_LLM_RAW,
      checksOrder: [
        'Technical Analyst',
        'Fundamental Analyst',
        'Sentiment Analyst',
        'On-Chain Analyst',
        'Risk Manager',
        'Macro Analyst',
        'AI Overseer',
      ],
      savedAt: now,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
