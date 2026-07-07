import type { Kpis } from "@/lib/leads/analytics";

export function StatusStrip({ kpis }: { kpis: Kpis }) {
  const items = [
    { label: "Ready", count: kpis.ready, bar: "bg-ready-fg", text: "text-ready-fg" },
    { label: "Not Ready", count: kpis.notReady, bar: "bg-notready-fg", text: "text-notready-fg" },
    { label: "Closed", count: kpis.closed, bar: "bg-closed-fg", text: "text-closed-fg" },
    { label: "Dropped", count: kpis.dropped, bar: "bg-dropped-fg", text: "text-dropped-fg" },
    { label: "Long Term", count: kpis.longTerm, bar: "bg-longterm-fg", text: "text-longterm-fg" },
  ];
  const total = kpis.total || 1;

  return (
    <div className="bg-surface border border-border rounded-lg p-4 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-5">
      {items.map((i) => {
        const pct = Math.round((i.count / total) * 100);
        return (
          <div key={i.label}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-text-muted">{i.label}</span>
              <span className={"text-xs font-mono " + i.text}>{pct}%</span>
            </div>
            <div className="text-2xl font-semibold text-text font-mono mt-1 leading-none">
              {i.count}
            </div>
            <div className="h-1.5 rounded-full bg-border-subtle mt-2 overflow-hidden">
              <div className={"h-full rounded-full " + i.bar} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
