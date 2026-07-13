import { Skeleton } from "@/components/common/Skeleton";

// Mirrors the AI Tools overview: title, tool cards, recent generations list.
export default function Loading() {
  return (
    <div>
      <div className="mb-5">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-72 mt-1.5" />
      </div>

      {/* tool cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-lg p-5">
            <div className="flex items-center gap-2 mb-1">
              <Skeleton className="w-2.5 h-2.5 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-4 w-full max-w-xs mt-2" />
            <Skeleton className="h-9 w-36 rounded-md mt-4" />
          </div>
        ))}
      </div>

      {/* recent generations */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="bg-surface border border-border rounded-lg divide-y divide-border-subtle">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 h-12">
            <Skeleton className="w-2 h-2 rounded-full shrink-0" />
            <Skeleton className="h-4 w-40" />
            <div className="ml-auto flex items-center gap-3">
              <Skeleton className="h-3 w-14 hidden sm:block" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
