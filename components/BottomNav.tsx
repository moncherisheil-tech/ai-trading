'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { useLocale } from '@/hooks/use-locale';
import { NAV_ITEMS, getNavLabel } from '@/lib/nav-config';

export default function BottomNav() {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <nav
      className="fixed bottom-0 start-0 end-0 z-[var(--z-header)] bg-[#111111]/95 border-t border-white/10 backdrop-blur-[60px] shadow-[0_-1px_0_0_rgba(255,255,255,0.05)] pb-[var(--safe-area-bottom)] md:hidden"
      role="navigation"
      aria-label="ניווט ראשי"
    >
      <div className="max-w-lg mx-auto flex items-stretch justify-around gap-1 px-1.5 py-1 min-w-0">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const label = getNavLabel(item, t as Record<string, string>);
          const isActive =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center justify-center flex-1 min-w-0 min-h-[56px] px-1 py-2 gap-1 rounded-xl transition-colors touch-manipulation ${isActive ? 'text-amber-400' : 'text-zinc-300 hover:text-zinc-100'}`}
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
              <span className="relative z-10 ui-label text-[11px] leading-tight text-center max-w-full whitespace-normal break-words">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
