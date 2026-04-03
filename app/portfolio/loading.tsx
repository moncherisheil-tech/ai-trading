export default function PortfolioLoading() {
  return (
    <div className="min-h-screen p-4 sm:p-6 space-y-4 animate-pulse" dir="rtl" aria-busy="true" aria-label="טוען תיק השקעות">
      <div className="h-10 w-48 rounded-xl bg-zinc-800/70" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-zinc-800/60" />
        ))}
      </div>
      <div className="h-64 rounded-2xl bg-zinc-800/60" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-zinc-800/50" />
        ))}
      </div>
    </div>
  );
}
