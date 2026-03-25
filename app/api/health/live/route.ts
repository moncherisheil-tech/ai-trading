import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    kind: 'live',
    timestamp: new Date().toISOString(),
    service: 'crypto-quant-ai',
  });
}
