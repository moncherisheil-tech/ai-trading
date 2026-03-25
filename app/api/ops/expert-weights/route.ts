import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getExpertWeights } from '@/lib/trading/expert-weights';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  if (isSessionEnabled()) {
    const cookieStore = await cookies();
    const token = cookieStore.get('app_auth_token')?.value ?? '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const weights = await getExpertWeights();
    return NextResponse.json({ expertWeights: weights });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load expert weights.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
