import { Skeleton } from "@/components/common/Skeleton";
import { TableSkeleton } from "@/components/common/TableSkeleton";

// Mirrors LeadsTable's layout: header, status tabs, toolbar, table, pagination.
export default function Loading() {
  return (
    <div>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-32 mt-1.5" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      {/* status tabs */}
      <div className="flex flex-wrap gap-1 mb-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-md" />
        ))}
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Skeleton className="h-9 flex-1 min-w-[220px]" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-24" />
      </div>

      {/* table */}
      <TableSkeleton rows={10} cols={7} toolbar={false} />

      {/* pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-48" />
      </div>
    </div>
  );
}
