import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

/**
 * Auth gate only. Global sidebar + navigation live in AppHeader (GlobalAppChrome).
 * No duplicate top horizontal nav on desktop.
 */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
    const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login?from=/ops');
    }
  }

  return <div className="min-h-0 w-full min-w-0" dir="rtl">{children}</div>;
}
