import { NextResponse } from 'next/server';
import { fetchForexUplink } from '@/lib/api-utils';
import { ensureTwelveDataConnection } from '@/lib/market/forex';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<NextResponse> {
  try {
    ensureTwelveDataConnection();
    const data = await fetchForexUplink(10_000);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'forex_unavailable';
    return NextResponse.json({ ok: false, error: msg, updatedAt: new Date().toISOString() }, { status: 200 });
  }
}
