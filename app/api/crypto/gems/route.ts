import { NextResponse } from 'next/server';
import { fetchGemsTicker24h } from '@/lib/gem-finder';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Returns 24h ticker data for coins that pass Gem Finder filter
 * (Liquidity >= $50k, 24h Volume >= $100k). Used for dashboard cards and real-time %.
 */
export async function GET() {
  try {
    const tickers = await fetchGemsTicker24h();
    return NextResponse.json(tickers);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to fetch gems';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
