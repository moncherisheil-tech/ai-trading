'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { ScanLine, Wallet, Target, Brain, Settings } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

const NAV_ITEMS = [
  { href: '/', label: 'סריקה', icon: ScanLine },
  { href: '/portfolio', label: 'תיק', icon: Wallet },
  { href: '/backtest', label: 'בקטסט', icon: Target },
  { href: '/insights', label: 'תובנות AI', icon: Brain },
  { href: '/settings', label: 'הגדרות', icon: Settings },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900/98 border-t border-zinc-700/80 pb-[env(safe-area-inset-bottom)]"
      role="navigation"
      aria-label="ניווט ראשי"
    >
      <div className="max-w-lg mx-auto flex items-center justify-around h-16 px-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-col items-center justify-center flex-1 min-w-0 py-2 gap-0.5 rounded-xl transition-colors touch-manipulation ${
                isActive ? 'text-amber-400' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive && (
                <motion.span
                  layoutId="bottom-nav-indicator"
                  className="absolute inset-0 rounded-xl bg-amber-500/10 border border-amber-500/20"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10 flex items-center justify-center">
                <Icon className="w-6 h-6" aria-hidden />
              </span>
              <span className="relative z-10 text-[10px] font-medium truncate max-w-full">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
