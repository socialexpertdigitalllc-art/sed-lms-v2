import { Skeleton } from "@/components/common/Skeleton";

// Mirrors ContractsList: page header + 4-column table.
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex gap-4 border-b border-border bg-surface-2 px-4 py-3">
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-32" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border-subtle px-4 py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-1.5 h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-40 shrink-0" />
            <div className="flex w-32 shrink-0 justify-end gap-2">
              <Skeleton className="h-7 w-16 rounded-md" />
              <Skeleton className="h-7 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
