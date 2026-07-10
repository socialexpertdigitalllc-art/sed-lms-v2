import { Skeleton } from "@/components/common/Skeleton";
import { TableSkeleton } from "@/components/common/TableSkeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-48" />
      <TableSkeleton rows={10} cols={7} />
    </div>
  );
}
