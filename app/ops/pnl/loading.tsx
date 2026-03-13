export default function PnlLoading() {
  return (
    <div className="min-h-screen bg-slate-950 p-6" dir="rtl">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-9 w-48 rounded-lg bg-slate-800 animate-pulse" />
        <div className="h-12 w-full max-w-md rounded-lg bg-slate-800 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-800/80 animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-slate-800/60 animate-pulse" />
      </div>
    </div>
  );
}
