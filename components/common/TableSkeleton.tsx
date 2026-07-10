import { Skeleton } from "./Skeleton";

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="border-b border-border bg-surface-2 px-4 py-3 flex gap-4">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="border-b border-border-subtle last:border-0 px-4 py-3 flex gap-4 items-center">
            {Array.from({ length: cols }).map((_, i) => (
              <Skeleton key={i} className={"h-4 flex-1 " + (i === 0 ? "max-w-[40px]" : "")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
