/**
 * GET /api/market/risk — Market Safety Sentinel status for dashboard.
 * Returns SAFE or DANGEROUS with reasoning (BTC/ETH volatility, ATR).
 */

import { NextResponse } from 'next/server';
import { getMarketRiskSentiment } from '@/lib/market-sentinel';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sentiment = await getMarketRiskSentiment();
    return NextResponse.json(sentiment);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: 'SAFE', reasoning: `שגיאה בבדיקה: ${msg}`, checkedAt: new Date().toISOString() },
      { status: 200 }
    );
  }
}
