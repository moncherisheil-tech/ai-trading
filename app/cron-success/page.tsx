/**
 * Minimal success page for cron trigger redirect.
 * Cron (e.g. /api/cron/scan) redirects here to force-close the connection quickly
 * so the background worker can keep running without 504 timeout.
 */

export const dynamic = 'force-dynamic';

export default function CronSuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#050505] p-4">
      <p className="text-neutral-400 text-sm">OK</p>
    </main>
  );
}
