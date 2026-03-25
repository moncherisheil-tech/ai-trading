import { NextRequest, NextResponse } from 'next/server';
import { fetchGemsTicker24h, fetchGemsTicker24hWithElite } from '@/lib/gem-finder';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Returns 24h ticker data for coins that pass Gem Finder filter.
 * ?elite=1 enriches with RSI/EMA and marks Elite (עוצמתי) signals.
 */
export async function GET(request: NextRequest) {
  const elite = request.nextUrl.searchParams.get('elite') === '1';
  try {
    const tickers = elite ? await fetchGemsTicker24hWithElite(undefined, 40) : await fetchGemsTicker24h();
    return NextResponse.json(tickers);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to fetch gems';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
