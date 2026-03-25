import { NextResponse } from 'next/server';
import { getAlphaSignalForecasts } from '@/lib/trading/forecast-engine';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  try {
    const data = await getAlphaSignalForecasts({ useLiveAnalysis: true });
    return NextResponse.json({
      success: true,
      mode: 'live',
      data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch alpha signals.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
