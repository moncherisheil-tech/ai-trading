import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import QuantumCommandCenter from '@/components/QuantumCommandCenter';

export const dynamic = 'force-dynamic';

export default async function QuantumAdminPage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login?from=/admin/quantum');
    }
  }

  return <QuantumCommandCenter />;
}
