'use client';

import { cn } from '@/lib/utils';

/**
 * Pulsating skeleton placeholder for loading states.
 * Use for tables, cards, and content that is being fetched.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-zinc-700/60', className)}
      aria-hidden
    />
  );
}
