import { NextResponse } from 'next/server';
import { getLatestActiveAlphaSignalsFromDb } from '@/lib/alpha-signals-db';
import { getPrisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  try {
    if (!getPrisma()) {
      return NextResponse.json({ success: true, mode: 'db', data: [] });
    }
    const data = await getLatestActiveAlphaSignalsFromDb(120);
    return NextResponse.json({ success: true, mode: 'db', data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch alpha signals.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
