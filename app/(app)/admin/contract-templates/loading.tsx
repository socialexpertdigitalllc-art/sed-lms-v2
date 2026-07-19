import { Skeleton } from "@/components/common/Skeleton";

function DocRow() {
  return (
    <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 last:border-0">
      <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="mt-1.5 h-3 w-32" />
      </div>
      <Skeleton className="h-7 w-16 shrink-0 rounded-md" />
    </div>
  );
}

// Mirrors ContractTemplatesManager: connection banner, folder card, two-column lists.
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-2 h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div>
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-1.5 h-3 w-52" />
          </div>
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="p-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-1.5 h-9 w-full rounded-md" />
        </div>
        <div className="flex justify-end border-t border-border-subtle bg-surface-2 px-4 py-3">
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, p) => (
          <div key={p} className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-4 w-40" />
            </div>
            {Array.from({ length: 3 }).map((_, i) => <DocRow key={i} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
