'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'error';

export type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
};

type ToastContextValue = {
  toasts: ToastItem[];
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback((message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { id, type: 'success', message }]);
    setTimeout(() => removeToast(id), TOAST_DURATION_MS);
  }, [removeToast]);

  const error = useCallback((message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { id, type: 'error', message }]);
    setTimeout(() => removeToast(id), TOAST_DURATION_MS);
  }, [removeToast]);

  const value: ToastContextValue = {
    toasts,
    success,
    error,
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
            aria-live={t.type === 'error' ? 'assertive' : 'polite'}
            className={`pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg border backdrop-blur-md transition-all duration-300 ${
              t.type === 'success'
                ? 'bg-emerald-500/95 text-white border-emerald-400/30'
                : 'bg-rose-500/95 text-white border-rose-400/30'
            }`}
          >
            {t.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden />
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
