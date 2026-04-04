import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { hasRequiredRole, isDevelopmentAuthBypass, isSessionEnabled, verifySessionToken } from '@/lib/session';
import { AUTH_COOKIE_NAME } from '@/lib/auth-constants';

export const dynamic = 'force-dynamic';

/**
 * Auth gate only. Global sidebar + navigation live in AppHeader (GlobalAppChrome).
 * No duplicate top horizontal nav on desktop.
 */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  try {
    if (!isDevelopmentAuthBypass() && isSessionEnabled()) {
      const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value || '';
      const session = verifySessionToken(token);
      if (!session || !hasRequiredRole(session.role, 'admin')) {
        redirect('/login?from=/ops');
      }
    }

    return <div className="min-h-0 w-full min-w-0" dir="rtl">{children}</div>;
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const e = error instanceof Error ? error : new Error(String(error));
    console.error('🚨 X-RAY CRASH LOG 🚨 [app/ops/layout.tsx]', e.name, e.message, e.stack);
    return (
      <div className="min-h-0 w-full min-w-0 p-6" dir="rtl">
        <div>SSR CRASH: Read Terminal (ops layout)</div>
      </div>
    );
  }
}
