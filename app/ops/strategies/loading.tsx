export default function StrategiesLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-900 to-slate-800 p-6" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="h-9 w-64 rounded-lg bg-slate-800 animate-pulse" />
        <div className="h-24 rounded-xl bg-slate-800/60 animate-pulse" />
        <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-6 space-y-4">
          <div className="h-5 w-40 rounded bg-slate-700 animate-pulse" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-slate-700/80 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
