import type { Metadata } from 'next';
// next/font/google disabled to avoid next-font-loader timeout in dev; using Tailwind system fonts
// import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import CryptoTicker from '@/components/CryptoTicker';
import PageTransition from '@/components/PageTransition';
import BottomNav from '@/components/BottomNav';
import { SimulationProvider } from '@/context/SimulationContext';

// const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
// const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'מערכת ניתוח כמותי | Mon Chéri Group',
  description: 'ניתוח כמותי ותובנות אסטרטגיה לשוק הקריפטו — Mon Chéri Group',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="font-sans bg-zinc-900 text-zinc-100 antialiased min-h-screen" suppressHydrationWarning>
        <CryptoTicker />
        <main className="flex-1">
          <SimulationProvider>
            <PageTransition>{children}</PageTransition>
          </SimulationProvider>
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
