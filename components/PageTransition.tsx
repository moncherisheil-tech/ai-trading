'use client';

import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, x: 32, y: 6, filter: 'blur(4px)' }}
        animate={{ opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, x: -26, y: -4, filter: 'blur(3px)' }}
        transition={{ type: 'spring', stiffness: 170, damping: 22, mass: 0.55 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
