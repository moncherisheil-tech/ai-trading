'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertCircle, Radio } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'cyber' | 'critical_cyber';

export type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
};

type ToastContextValue = {
  toasts: ToastItem[];
  success: (message: string) => void;
  error: (message: string) => void;
  /** High-visibility ops / stream anomaly toast (cyan/violet, longer duration). */
  cyber: (message: string) => void;
  /** Execution / sovereign robot failure — maximum visibility. */
  criticalCyber: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 4500;
const CYBER_TOAST_DURATION_MS = 7000;
const CRITICAL_CYBER_TOAST_DURATION_MS = 14_000;
const createToastId = (): string => `toast-${crypto.randomUUID()}`;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback((message: string) => {
    const id = createToastId();
    setToasts((prev) => [...prev, { id, type: 'success', message }]);
    setTimeout(() => removeToast(id), TOAST_DURATION_MS);
  }, [removeToast]);

  const error = useCallback((message: string) => {
    const id = createToastId();
    setToasts((prev) => [...prev, { id, type: 'error', message }]);
    setTimeout(() => removeToast(id), TOAST_DURATION_MS);
  }, [removeToast]);

  const cyber = useCallback((message: string) => {
    const id = createToastId();
    setToasts((prev) => [...prev, { id, type: 'cyber', message }]);
    setTimeout(() => removeToast(id), CYBER_TOAST_DURATION_MS);
  }, [removeToast]);

  const criticalCyber = useCallback((message: string) => {
    const id = createToastId();
    setToasts((prev) => [...prev, { id, type: 'critical_cyber', message }]);
    setTimeout(() => removeToast(id), CRITICAL_CYBER_TOAST_DURATION_MS);
  }, [removeToast]);

  const value: ToastContextValue = {
    toasts,
    success,
    error,
    cyber,
    criticalCyber,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="הודעות מערכת"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[var(--z-toast)] flex flex-col gap-2 max-w-[min(calc(100vw-2rem),28rem)] pointer-events-none"
        dir="rtl"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            aria-live={t.type === 'error' || t.type === 'critical_cyber' ? 'assertive' : 'polite'}
            className={`pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg border backdrop-blur-[60px] transition-all duration-300 ${
              t.type === 'success'
                ? 'bg-emerald-500/95 text-white border-emerald-400/30'
                : t.type === 'cyber'
                  ? 'bg-gradient-to-r from-violet-950/95 via-cyan-950/90 to-zinc-950/95 text-cyan-100 border-cyan-400/40 shadow-[0_0_28px_rgba(34,211,238,0.35)] font-mono text-[13px] tracking-tight'
                  : t.type === 'critical_cyber'
                    ? 'bg-gradient-to-r from-rose-950/95 via-violet-950/95 to-zinc-950/95 text-rose-100 border-rose-400/55 shadow-[0_0_36px_rgba(244,63,94,0.45)] font-mono text-[13px] tracking-tight tabular-nums'
                    : 'bg-rose-500/95 text-white border-rose-400/30'
            }`}
          >
            {t.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden />
            ) : t.type === 'cyber' ? (
              <Radio className="w-5 h-5 shrink-0 text-cyan-300 animate-pulse" aria-hidden />
            ) : t.type === 'critical_cyber' ? (
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-300 animate-pulse" aria-hidden />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0" aria-hidden />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

export function useToastOptional(): ToastContextValue | null {
  return useContext(ToastContext);
}
