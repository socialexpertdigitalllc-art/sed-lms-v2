import { Skeleton } from "@/components/common/Skeleton";

function ChartBox({ className = "" }: { className?: string }) {
  return (
    <div className={"bg-surface border border-border rounded-lg p-3 flex flex-col " + className}>
      <Skeleton className="h-4 w-32 mb-3" />
      <Skeleton className="w-full flex-1" />
    </div>
  );
}

// Mirrors DashboardBoard: filters, title, KpiHero, StatGrid, StatusStrip,
// then the flowing lg:grid-cols-6 chart grid (static span classes).
export default function Loading() {
  return (
    <div className="space-y-5">
      {/* filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-32" />
      </div>

      {/* title */}
      <div>
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-56 mt-1.5" />
      </div>

      {/* KPI hero */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-lg p-3">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-7 w-16 mt-2" />
            <Skeleton className="h-3 w-24 mt-1.5" />
          </div>
        ))}
      </div>

      {/* stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-lg p-2.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-5 w-14 mt-1.5" />
            <Skeleton className="h-3 w-16 mt-1" />
          </div>
        ))}
      </div>

      {/* status strip */}
      <div className="bg-surface border border-border rounded-lg p-4 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <div className="flex items-baseline justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton className="h-6 w-10 mt-1.5" />
            <Skeleton className="h-1.5 w-full rounded-full mt-2" />
          </div>
        ))}
      </div>

      {/* charts */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
        <ChartBox className="lg:col-span-4 h-56" />
        <ChartBox className="lg:col-span-2 h-56" />
        <ChartBox className="lg:col-span-2 h-48" />
        <ChartBox className="lg:col-span-2 h-48" />
        <ChartBox className="lg:col-span-2 h-48" />
        <ChartBox className="lg:col-span-3 h-48" />
        <ChartBox className="lg:col-span-3 h-48" />
        {/* fresh vs follow-up strip */}
        <div className="bg-surface border border-border rounded-lg p-3 lg:col-span-6">
          <Skeleton className="h-4 w-32 mb-3" />
          <Skeleton className="h-3 w-full rounded-full" />
          <div className="flex gap-6 mt-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}
