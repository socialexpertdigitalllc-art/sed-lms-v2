import { Skeleton } from "@/components/common/Skeleton";

function LinkRow() {
  return (
    <div className="flex items-center justify-between gap-3 px-4 h-14 overflow-hidden">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56 mt-1.5 hidden sm:block" />
      </div>
      <Skeleton className="h-5 w-16 shrink-0" />
      <div className="flex items-center gap-1.5 shrink-0">
        <Skeleton className="h-7 w-[84px] rounded-md" />
        <Skeleton className="h-8 w-8 rounded" />
      </div>
    </div>
  );
}

// Mirrors PaymentLinksBoard: header with search/pills/button, category sections.
export default function Loading() {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-16 mt-1.5" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      {Array.from({ length: 2 }).map((_, s) => (
        <section key={s} className="mb-6">
          <Skeleton className="h-3 w-24 mb-2" />
          <div className="bg-surface border border-border rounded-lg divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <LinkRow key={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
