'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  title?: string;
};

type State = { hasError: boolean };

/**
 * Isolates chart / feed failures so one bad fetch does not white-screen the dashboard.
 */
export default class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[SectionErrorBoundary]', error.message, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="rounded-xl border border-amber-500/35 bg-amber-950/25 px-4 py-6 text-center"
          role="alert"
        >
          <p className="text-sm font-semibold text-amber-100">
            {this.props.title ?? 'הנתונים אינם זמינים כרגע'}
          </p>
          <p className="mt-1 text-xs text-amber-200/80">Data Unavailable — הרכיב הוסר בבטחה ממעגל ה-UI.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
