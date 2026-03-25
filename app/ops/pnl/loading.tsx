import { Skeleton } from '@/components/ui/Skeleton';

export default function PnlLoading() {
  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full overflow-x-hidden" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 min-w-0">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <Skeleton className="h-10 w-32 rounded-xl" />
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 min-w-0">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border border-white/5 bg-[#111111] p-6">
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-28 mt-1" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#111111] p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-lg" />
            <div>
              <Skeleton className="h-5 w-48 mb-1" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <Skeleton className="h-3 w-12 mb-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 min-w-0">
        <div className="rounded-2xl border border-white/5 bg-[#111111] p-6">
          <Skeleton className="h-4 w-24 mb-4" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
        <div className="rounded-2xl border border-white/5 bg-[#111111] p-6">
          <Skeleton className="h-4 w-40 mb-4" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#111111] overflow-hidden">
        <Skeleton className="h-12 w-full rounded-none" />
        <div className="p-6 space-y-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
