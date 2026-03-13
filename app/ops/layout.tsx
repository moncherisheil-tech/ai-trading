import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LayoutDashboard, BarChart3, LineChart, Settings } from 'lucide-react';
import LogoutButton from '@/components/LogoutButton';
import TelegramStatus from '@/components/TelegramStatus';
import { getT } from '@/lib/i18n';
import { hasRequiredRole, isSessionEnabled, verifySessionToken } from '@/lib/session';

const t = getT('he');

export const dynamic = 'force-dynamic';

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (isSessionEnabled()) {
    const token = (await cookies()).get('app_auth_token')?.value || '';
    const session = verifySessionToken(token);
    if (!session || !hasRequiredRole(session.role, 'admin')) {
      redirect('/login?from=/ops');
    }
  }

  return (
    <div className="min-h-screen bg-zinc-900" dir="rtl">
      <header className="border-b border-zinc-700 bg-zinc-800/95 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-medium hidden sm:inline" aria-hidden>Mon Chéri Group</span>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/ops" className="flex items-center gap-2 text-zinc-300 hover:text-amber-400 transition-colors" prefetch={true}>
              <LayoutDashboard className="w-4 h-4" /> {t.opsDashboard}
            </Link>
            <Link href="/ops/strategies" className="flex items-center gap-2 text-zinc-300 hover:text-amber-400 transition-colors" prefetch={true}>
              <BarChart3 className="w-4 h-4" /> {t.strategyInsights}
            </Link>
            <Link href="/ops/pnl" className="flex items-center gap-2 text-zinc-300 hover:text-amber-400 transition-colors" prefetch={true}>
              <LineChart className="w-4 h-4" /> {t.pnlTerminal}
            </Link>
            <Link href="/settings" className="flex items-center gap-2 text-zinc-300 hover:text-amber-400 transition-colors" prefetch={true}>
              <Settings className="w-4 h-4" /> {t.settings}
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <TelegramStatus />
            <LogoutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
