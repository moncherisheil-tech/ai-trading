import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import AdminTerminalPageClient from '@/components/AdminTerminalPageClient';

export const dynamic = 'force-dynamic';

export default async function AdminTerminalPage() {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login?from=/admin/terminal');
    }
  }

  return <AdminTerminalPageClient />;
}
