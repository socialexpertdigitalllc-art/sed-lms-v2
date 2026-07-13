import { Skeleton } from "@/components/common/Skeleton";

function TicketRow() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 h-14 overflow-hidden">
      <div className="flex min-w-0 items-center gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <div className="hidden md:flex items-center gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="w-5 h-5 rounded-full" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="hidden sm:flex items-center gap-3">
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-10" />
      </div>
    </div>
  );
}

// Mirrors TicketQueue: header with filters, then status-grouped row sections.
export default function Loading() {
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-20 mt-1.5" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {Array.from({ length: 3 }).map((_, s) => (
        <section key={s} className="mb-6">
          <Skeleton className="h-4 w-32 mb-2" />
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <TicketRow key={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
