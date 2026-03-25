export default function PerformanceLoading() {
  return (
    <main
      className="min-h-screen bg-[var(--app-bg,#030f1c)] text-[var(--app-text)] overflow-x-hidden pb-24 sm:pb-8 flex items-center justify-center"
      dir="rtl"
    >
      <div className="flex flex-col items-center gap-4 text-[var(--app-muted)]">
        <div className="w-10 h-10 border-2 border-[var(--app-accent)]/40 border-t-[var(--app-accent)] rounded-full animate-spin" />
        <p className="text-sm">טוען תצוגת ביצועים…</p>
      </div>
    </main>
  );
}
