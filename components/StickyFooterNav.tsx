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
    <div className="mt-auto">
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

