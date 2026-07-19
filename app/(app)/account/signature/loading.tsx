import { Skeleton } from "@/components/common/Skeleton";

// Mirrors SignatureCard: header, preview well, two fields, footer action.
export default function Loading() {
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
          <Skeleton className="h-7 w-7 rounded-md" />
          <div>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-1.5 h-3 w-72" />
          </div>
        </div>
        <div className="space-y-4 p-4">
          <Skeleton className="h-24 w-full rounded-md" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-1.5 h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t border-border-subtle bg-surface-2 px-4 py-3">
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
      </div>
    </div>
  );
}
