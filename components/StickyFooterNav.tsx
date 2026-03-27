'use client';

import BottomNav from '@/components/BottomNav';
import LegalDisclaimer from '@/components/LegalDisclaimer';

/**
 * Unified sticky footer:
 * - Mobile: bottom navigation bar with icons (BottomNav).
 * - Desktop: full legal footer with yellow risk disclaimer (LegalDisclaimer).
 *
 * This component must be the only footer/navigation element mounted at the bottom of the viewport.
 */
export default function StickyFooterNav() {
  return (
    <div
      className="mt-auto shrink-0 w-full min-w-0 max-w-full overflow-x-hidden md:pe-[var(--app-main-inline-offset)]"
      dir="rtl"
    >
      {/* Mobile bottom navigation (icons) */}
      <div className="md:hidden">
        <BottomNav />
      </div>

      {/* Desktop legal footer with disclaimer */}
      <div className="hidden md:block">
        <LegalDisclaimer />
      </div>
    </div>
  );
}

