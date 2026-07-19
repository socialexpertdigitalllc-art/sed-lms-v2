import { Skeleton } from "@/components/common/Skeleton";

// Mirrors CompanyMailManager: link form panel + mailbox list panel.
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <Skeleton className="h-7 w-44" />
          <Skeleton className="mt-2 h-4 w-96" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
          <Skeleton className="h-7 w-7 rounded-md" />
          <div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-1.5 h-3 w-64" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-1.5 h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t border-border-subtle bg-surface-2 px-4 py-3">
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-4 w-36" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-0">
            <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="mt-1.5 h-3 w-32" />
            </div>
            <Skeleton className="hidden h-8 w-36 shrink-0 sm:block" />
            <div className="flex shrink-0 gap-1">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
