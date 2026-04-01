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
 * Desktop uses strict 2-column grid so sidebar never overlaps content.
 */
export default function GlobalAppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === LOGIN_PATH;

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <MarketStateProvider>
      <div className="min-h-screen w-full grid grid-cols-1 md:grid-cols-[1fr_280px]">
        <div className="sovereign-shell relative z-[1] block min-h-screen min-w-0 max-w-full pt-[calc(var(--safe-area-top)+5rem)] md:pt-0">
          <CryptoTicker />
          <main className="relative z-0 block min-h-screen min-w-0 max-w-full pb-[calc(var(--safe-area-bottom)+5.5rem)] md:pb-0">
            <ToastProvider>
              <SimulationProvider>
                <PageTransition>{children}</PageTransition>
              </SimulationProvider>
            </ToastProvider>
            <ConsultationChat />
          </main>
        </div>
        <div className="block">
          <AppHeader />
        </div>
      </div>
    </MarketStateProvider>
  );
}
