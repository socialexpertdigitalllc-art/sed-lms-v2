import { Skeleton } from "@/components/common/Skeleton";

// Mirrors the pre-leads page: title, then [PreLeadOverview | WorldClocks].
export default function Loading() {
  return (
    <div>
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-56 mt-1.5" />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 mt-5">
        {/* left: overview */}
        <div className="space-y-5">
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface border border-border rounded-lg p-4">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-7 w-12 mt-2" />
              </div>
            ))}
          </div>

          {/* category distribution + service split */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-surface border border-border rounded-lg p-5">
              <Skeleton className="h-4 w-40 mb-4" />
              <div className="space-y-2.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-5 w-28 shrink-0 rounded-full" />
                    <Skeleton className="h-2 flex-1 rounded-full" />
                    <Skeleton className="h-4 w-8 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-surface border border-border rounded-lg p-5">
              <Skeleton className="h-4 w-28 mb-4" />
              <div className="space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* follow-ups due + recent activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, c) => (
              <div key={c} className="bg-surface border border-border rounded-lg p-5">
                <Skeleton className="h-4 w-44 mb-4" />
                <div className="divide-y divide-border-subtle">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* right: world clocks */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-8" />
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="h-9 w-16" />
          </div>
          <div className="mt-3 divide-y divide-border-subtle">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-20 mt-1.5" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
