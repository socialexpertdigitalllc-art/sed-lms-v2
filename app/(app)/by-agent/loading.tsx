import { Skeleton } from "@/components/common/Skeleton";

function AgentCard() {
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      {/* avatar + name + revenue */}
      <div className="flex items-center gap-3">
        <Skeleton className="w-9 h-9 rounded-full" />
        <div>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-16 mt-1.5" />
        </div>
        <div className="ml-auto flex flex-col items-end">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-2.5 w-10 mt-1.5" />
        </div>
      </div>

      {/* 3-stat mini grid */}
      <div className="grid grid-cols-3 gap-2 mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-surface-2 border border-border rounded-md px-3 py-2">
            <Skeleton className="h-6 w-8" />
            <Skeleton className="h-2.5 w-12 mt-1.5" />
          </div>
        ))}
      </div>

      {/* recent leads table lines */}
      <div className="mt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 border-t border-border-subtle py-2.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Mirrors the by-agent page: title, subtitle, 2-col grid of agent cards.
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-7 w-36 mb-1" />
      <Skeleton className="h-4 w-64 mb-5" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <AgentCard key={i} />
        ))}
      </div>
    </div>
  );
}
