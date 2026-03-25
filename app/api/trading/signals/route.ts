import { NextRequest, NextResponse } from 'next/server';
import { getAlphaSignalForecasts } from '@/lib/trading/forecast-engine';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseLiveFlag(value: string | null): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'live'].includes(value.toLowerCase());
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const live = parseLiveFlag(new URL(request.url).searchParams.get('live'));
    const data = await getAlphaSignalForecasts({ useLiveAnalysis: live });
    return NextResponse.json({
      success: true,
      mode: live ? 'live' : 'mock',
      data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch alpha signals.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
