export default function SettingsLoading() {
  return (
    <div className="min-h-screen bg-zinc-950 p-6 sm:p-8 space-y-6 animate-pulse" dir="rtl" aria-busy="true" aria-label="טוען הגדרות">
      <div className="h-10 w-56 rounded-xl bg-zinc-800/70" />
      <div className="h-6 w-80 rounded-lg bg-zinc-800/50" />
      <div className="h-32 rounded-2xl bg-zinc-800/60" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="h-48 rounded-2xl bg-zinc-800/60" />
        <div className="h-48 rounded-2xl bg-zinc-800/60" />
      </div>
      <div className="h-40 rounded-2xl bg-zinc-800/60" />
    </div>
  );
}
