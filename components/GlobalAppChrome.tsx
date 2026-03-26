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
      <div className="grid w-full min-h-screen md:grid-cols-[minmax(0,1fr)_280px] md:grid-rows-[auto_1fr]">
        <AppHeader />
        <div className="sovereign-shell relative z-[1] block min-h-screen min-w-0 max-w-full pt-20 md:pt-0 md:pr-[280px] [grid-area:main]">
          <CryptoTicker />
          <main className="relative z-0 block min-h-screen min-w-0 max-w-full pb-20 md:pb-0">
            <ToastProvider>
              <SimulationProvider>
                <PageTransition>{children}</PageTransition>
              </SimulationProvider>
            </ToastProvider>
            <ConsultationChat />
          </main>
        </div>
        <div className="hidden md:block [grid-area:side]" aria-hidden />
      </div>
    </MarketStateProvider>
  );
}
