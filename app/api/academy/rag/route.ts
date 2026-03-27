import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { querySimilarTrades } from '@/lib/vector-db';
import { getGeminiApiKey } from '@/lib/env';
import { APP_CONFIG } from '@/lib/config';
import { GEMINI_DEFAULT_FLASH_MODEL_ID, resolveGeminiModel } from '@/lib/gemini-model';
import { validateAdminOrCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RagRequest = {
  symbol?: string;
  question?: string;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!validateAdminOrCronAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: RagRequest;
  try {
    body = (await request.json()) as RagRequest;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }
  const symbol = (body.symbol || '').toUpperCase().trim();
  const question = (body.question || '').trim();
  if (!symbol || !question) {
    return NextResponse.json({ ok: false, error: 'symbol and question are required.' }, { status: 400 });
  }

  try {
    const hits = await querySimilarTrades(symbol, 3);
    if (hits.length === 0) {
      return NextResponse.json({
        ok: true,
        status: 'AWAITING_LIVE_DATA',
        answer: 'No Deep Memory retrieval hit was found for this symbol yet.',
        retrieved: [],
      });
    }

    const context = hits
      .map((hit, idx) => `${idx + 1}. [${hit.symbol} #${hit.trade_id}] ${hit.text}`)
      .join('\n');

    const genAI = new GoogleGenerativeAI(getGeminiApiKey());
    const selected = resolveGeminiModel(APP_CONFIG.primaryModel || GEMINI_DEFAULT_FLASH_MODEL_ID);
    const model = genAI.getGenerativeModel({ model: selected.model }, selected.requestOptions);
    const response = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `You are Academy RAG assistant.\n` +
                `You MUST ONLY use the provided Pinecone context. If the context does not contain the answer, reply EXACTLY with: "INSUFFICIENT_MEMORY_NO_ACTION". Do not hallucinate or extrapolate.\n\n` +
                `Question: ${question}\n` +
                `Symbol: ${symbol}\n` +
                `Retrieved context:\n${context}`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
    });

    return NextResponse.json({
      ok: true,
      status: 'LIVE',
      answer: response.response.text().trim(),
      retrieved: hits,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'RAG request failed.',
      },
      { status: 500 }
    );
  }
}

