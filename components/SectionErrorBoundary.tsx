'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

type Props = {
  children: ReactNode;
  /** Hebrew label shown in the offline badge. */
  title?: string;
  /** When true the error is shown inline without a border-card wrapper */
  compact?: boolean;
};

type State = { hasError: boolean; errorMessage: string };

/**
 * Isolates widget / chart / feed failures so one bad component does not
 * white-screen the dashboard. Provides a localised "Component Offline" badge
 * with a manual retry button instead of a full-page 500 crash.
 */
export default class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message ?? 'Unknown error' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[SectionErrorBoundary]', error.message, info.componentStack?.slice(0, 300));
  }

  handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const label = this.props.title ?? 'הנתונים אינם זמינים כרגע';

    if (this.props.compact) {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-amber-950/40 text-amber-300 border border-amber-500/25"
          role="alert"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
          {label}
        </span>
      );
    }

    return (
      <div
        className="rounded-xl border border-amber-500/35 bg-amber-950/25 px-4 py-5 text-center"
        role="alert"
        dir="rtl"
      >
        <div className="flex items-center justify-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden />
          <p className="text-sm font-semibold text-amber-100">{label}</p>
        </div>
        <p className="mt-0.5 text-xs text-amber-200/70">
          רכיב הוסר בבטחה ממעגל ה-UI — Component Offline.
        </p>
        {this.state.errorMessage ? (
          <p className="mt-1 text-xs text-zinc-500 font-mono break-all" dir="ltr">
            {this.state.errorMessage.slice(0, 120)}
          </p>
        ) : null}
        <button
          type="button"
          onClick={this.handleReset}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 text-amber-200 text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          נסה שוב
        </button>
      </div>
    );
  }
}
