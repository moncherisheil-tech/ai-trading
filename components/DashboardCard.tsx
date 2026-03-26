'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

interface DashboardCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export default function DashboardCard({ children, className = '', delay = 0 }: DashboardCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.2, 0.8, 0.2, 1] }}
      className={`ui-card rounded-[var(--ui-radius-xl)] border border-[var(--app-border)] bg-[var(--app-surface)]/80 backdrop-blur-md shadow-lg overflow-hidden will-change-opacity transition-opacity duration-300 ${className}`}
    >
      {children}
    </motion.div>
  );
}
