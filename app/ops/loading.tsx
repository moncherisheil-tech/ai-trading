export default function OpsLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-900 to-slate-800 p-6" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="h-9 w-56 rounded-lg bg-slate-800 animate-pulse" />
        <div className="h-11 w-40 rounded-lg bg-slate-800 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-slate-700/80 bg-slate-800/60 p-4 space-y-2">
              <div className="h-3 w-20 rounded bg-slate-700 animate-pulse" />
              <div className="h-8 w-14 rounded bg-slate-700 animate-pulse" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-slate-700/80 bg-slate-800/60 p-4 space-y-2">
              <div className="h-3 w-24 rounded bg-slate-700 animate-pulse" />
              <div className="h-8 w-12 rounded bg-slate-700 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
