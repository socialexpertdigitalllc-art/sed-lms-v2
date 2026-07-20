import { Skeleton } from "@/components/common/Skeleton";

/** Mirrors the page: header, order panel, two provider cards, dashboard. */
function ProviderCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-start gap-3">
          <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
          <div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-1.5 h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-6 w-11 rounded-full" />
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <Skeleton className="h-28 rounded-md" />
        <Skeleton className="h-28 rounded-md" />
        <Skeleton className="h-20 rounded-md lg:col-span-2" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="border-b border-border pb-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-9 w-48 rounded-md" />
        </div>
        <div className="p-4">
          <Skeleton className="h-3 w-72" />
        </div>
      </div>

      {Array.from({ length: 2 }).map((_, i) => (
        <ProviderCardSkeleton key={i} />
      ))}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, s) => (
              <Skeleton key={s} className="h-[76px] rounded-md" />
            ))}
          </div>
          <Skeleton className="h-40 rounded-md" />
        </div>
      </div>
    </div>
  );
}
