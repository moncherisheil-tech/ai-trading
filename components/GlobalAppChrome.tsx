'use client';

import { usePathname } from 'next/navigation';
import CryptoTicker from '@/components/CryptoTicker';
import PageTransition from '@/components/PageTransition';
import AppHeader from '@/components/AppHeader';
import ConsultationChat from '@/components/ConsultationChat';
import { SimulationProvider } from '@/context/SimulationContext';
import { ToastProvider } from '@/context/ToastContext';
import { MarketStateProvider } from '@/context/MarketStateContext';

const LOGIN_PATH = '/login';

/**
 * Global shell: sidebar (AppHeader) on every authenticated route including /ops.
 * Main content uses physical padding-right for a fixed right sidebar under global RTL.
 */
export default function GlobalAppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === LOGIN_PATH;

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <MarketStateProvider>
      <div className="flex flex-1 min-h-0 min-w-0 w-full max-w-full flex-col">
        <AppHeader />
        <div
          className="sovereign-shell relative z-[1] flex flex-1 min-h-0 min-w-0 max-w-full flex-col overflow-x-hidden overflow-y-auto pt-20 md:pt-0 transition-[padding] duration-200 md:pr-[var(--app-main-inline-offset)]"
        >
          <CryptoTicker />
          <main className="flex flex-1 min-h-0 min-w-0 max-w-full flex-col pb-20 md:pb-0 relative z-0">
            <ToastProvider>
              <SimulationProvider>
                <PageTransition>{children}</PageTransition>
              </SimulationProvider>
            </ToastProvider>
            <ConsultationChat />
          </main>
        </div>
      </div>
    </MarketStateProvider>
  );
}
