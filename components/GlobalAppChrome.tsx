'use client';

import { usePathname } from 'next/navigation';
import CryptoTicker from '@/components/CryptoTicker';
import PageTransition from '@/components/PageTransition';
import AppHeader from '@/components/AppHeader';
import ConsultationChat from '@/components/ConsultationChat';
import { SimulationProvider } from '@/context/SimulationContext';
import { ToastProvider } from '@/context/ToastContext';
import { MarketStateProvider } from '@/context/MarketStateContext';
import { useLocale } from '@/hooks/use-locale';

const LOGIN_PATH = '/login';

/**
 * Global shell: sidebar (AppHeader) on every authenticated route including /ops.
 * Main content offset uses --app-sidebar-width (updated by AppHeader when collapsed).
 */
export default function GlobalAppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isRtl } = useLocale();
  const isLoginPage = pathname === LOGIN_PATH;

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <MarketStateProvider>
      <AppHeader />
      <div
        className={`sovereign-shell relative z-[1] flex flex-1 min-h-0 flex-col pt-20 md:pt-0 transition-[padding] duration-200 ${isRtl ? 'md:pe-[var(--app-sidebar-width,280px)]' : 'md:ps-[var(--app-sidebar-width,280px)]'}`}
      >
        <CryptoTicker />
        <main className="flex-1 flex flex-col min-h-0 pb-20 md:pb-0">
          <ToastProvider>
            <SimulationProvider>
              <PageTransition>{children}</PageTransition>
            </SimulationProvider>
          </ToastProvider>
          <ConsultationChat />
        </main>
      </div>
    </MarketStateProvider>
  );
}
