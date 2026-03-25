'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Loader2 } from 'lucide-react';
import { evaluatePendingPredictions } from '@/app/actions';

export default function EvaluatePredictionsButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const handleEvaluate = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const result = await evaluatePendingPredictions();
      if (result.success) {
        const updatedCount = result.updatedCount ?? 0;
        setMessage({
          text: updatedCount > 0
            ? `הוערכו ${updatedCount} תחזיות. רענן את הדף כדי לראות את הלקחים.`
            : 'אין תחזיות ממתינות להערכה.',
          ok: true,
        });
        router.refresh();
      } else {
        setMessage({ text: 'ההערכה נכשלה. נסה שוב.', ok: false });
      }
    } catch {
      setMessage({ text: 'שגיאה בהפעלת ההערכה.', ok: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-700/80 bg-zinc-800/40 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            הערכת תחזיות ממתינות
          </h3>
          <p className="text-xs text-zinc-400 mt-1">
            משווה תחזיות למחירי שוק נוכחיים, מייצר מסקנות למידה ומרענן את לולאת הפידבק.
          </p>
        </div>
        <button
          type="button"
          onClick={handleEvaluate}
          disabled={loading}
          aria-label="הערך תחזיות ממתינות"
          className="min-h-[44px] px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-70 disabled:cursor-not-allowed text-white rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              מעריך…
            </>
          ) : (
            <>
              <Database className="w-5 h-5" />
              הערך תחזיות ממתינות
            </>
          )}
        </button>
      </div>
      {message && (
        <p
          className={`mt-3 text-sm ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}
          role="status"
          aria-live="polite"
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
