import type { Metadata, Viewport } from 'next';
// next/font/google disabled to avoid next-font-loader timeout in dev; using Tailwind system fonts
// import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Script from 'next/script';
import PwaMeta from '@/components/PwaMeta';
import RegisterServiceWorker from '@/components/RegisterServiceWorker';
import { ThemeApplicator } from '@/context/AppSettingsContext';
import GlobalAppChrome from '@/components/GlobalAppChrome';
import StickyFooterNav from '@/components/StickyFooterNav';

// const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
// const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Quantum Crypto | Mon Chéri',
  description:
    'Quantum Crypto analytics and simulation terminal by Mon Chéri. Educational and simulation information only, not investment advice.',
  manifest: '/manifest.json',
  robots: 'noindex, nofollow',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Quantum Crypto',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#050505',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className="overflow-x-hidden" data-theme="dark" suppressHydrationWarning>
      <body
        dir="rtl"
        className="font-sans bg-[var(--background)] text-[var(--app-text)] antialiased min-h-screen min-h-[100dvh] overflow-x-hidden max-w-[100vw] flex flex-col"
        suppressHydrationWarning
      >
        <Script id="locale-init" strategy="beforeInteractive">
          {`(function(){try{document.documentElement.lang='he';document.documentElement.dir='rtl';}catch(e){}})();`}
        </Script>
        <PwaMeta />
        <RegisterServiceWorker />
        <ThemeApplicator>
          <GlobalAppChrome>{children}</GlobalAppChrome>
          {/* Unified sticky footer/nav for all viewports */}
          <StickyFooterNav />
        </ThemeApplicator>
      </body>
    </html>
  );
}
