import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import AlphaSignalsDashboard from '@/components/AlphaSignalsDashboard';

export const dynamic = 'force-dynamic';

export default async function AlphaSignalsPage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login?from=/admin/signals');
    }
  }

  return <AlphaSignalsDashboard />;
}
