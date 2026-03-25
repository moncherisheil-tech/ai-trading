'use client';

import { motion } from 'motion/react';
import { BarChart3 } from 'lucide-react';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';

export default function AnalyticsPage() {
  return (
    <main
      className="min-h-screen bg-[var(--app-bg,#050505)] text-[var(--app-text,rgb(244,244,245))] overflow-x-hidden pb-24 sm:pb-8"
      dir="rtl"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <motion.h1
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold flex items-center gap-3"
        >
          <span className="p-2 rounded-xl bg-[var(--app-accent,rgb(34,197,94))]/20 text-[var(--app-accent)] border border-[var(--app-accent)]/30">
            <BarChart3 className="w-6 h-6" />
          </span>
          מרכז אנליטיקה היסטורית
        </motion.h1>
        <AnalyticsDashboard />
      </div>
    </main>
  );
}
