import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  return (
    <main className="min-h-screen bg-[#050505] text-zinc-100 px-4 py-10" dir="rtl">
      <div className="max-w-2xl mx-auto rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-amber-400 mb-2">פרופיל מנהלים</h1>
        <p className="text-zinc-300 leading-relaxed">
          הדף נמצא בשלבי השקה אחרונים. בינתיים אפשר להמשיך דרך לוח ההגדרות והביצועים.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/settings"
            className="rounded-xl border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/25 transition-colors"
          >
            מעבר להגדרות
          </Link>
          <Link
            href="/ops"
            className="rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/[0.06] transition-colors"
          >
            חזרה לדשבורד
          </Link>
        </div>
      </div>
    </main>
  );
}
