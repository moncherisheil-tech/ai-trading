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
      transition={{ duration: 0.35, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={`rounded-2xl border border-zinc-700/80 bg-zinc-800/90 shadow-lg overflow-hidden ${className}`}
    >
      {children}
    </motion.div>
  );
}
