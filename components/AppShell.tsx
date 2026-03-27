'use client';

import { usePathname } from 'next/navigation';
import CryptoTicker from '@/components/CryptoTicker';
import PageTransition from '@/components/PageTransition';
import AppHeader from '@/components/AppHeader';
import ConsultationChat from '@/components/ConsultationChat';
import { SimulationProvider } from '@/context/SimulationContext';
import { ToastProvider } from '@/context/ToastContext';

const LOGIN_PATH = '/login';

/**
 * Wraps app content and conditionally renders dashboard chrome (header, ticker, main layout, bottom nav).
 * On /login we render only children. On /ops/* the ops layout provides its own header, so we omit AppHeader.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === LOGIN_PATH;
  const isOpsArea = pathname.startsWith('/ops');

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <>
      {!isOpsArea && <AppHeader />}
      <div className="flex flex-1 min-h-0 flex-col pt-[calc(var(--safe-area-top)+5rem)] md:pt-0 md:pe-[280px]">
        <CryptoTicker />
        <main className="flex-1 flex flex-col min-h-0 pb-[calc(var(--safe-area-bottom)+5.5rem)] md:pb-0">
          <ToastProvider>
            <SimulationProvider>
              <PageTransition>{children}</PageTransition>
            </SimulationProvider>
          </ToastProvider>
          <ConsultationChat />
        </main>
      </div>
    </>
  );
}
