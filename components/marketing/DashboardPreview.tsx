import { BrandMark } from "@/components/branding/BrandMark";

// A static, on-brand miniature of the real Data Console dashboard.
// Used as the landing hero visual — same tokens as the live app.
export function DashboardPreview({
  companyName,
  logoUrl,
}: {
  companyName: string;
  logoUrl: string | null;
}) {
  const bars = [62, 88, 45, 70, 35, 54];
  const rows = [
    { biz: "Brava Roofing", agent: "Alex", status: "Ready", cls: "bg-ready-bg text-ready-fg", price: "$750" },
    { biz: "Lumen Dental", agent: "Evan", status: "Not Ready", cls: "bg-notready-bg text-notready-fg", price: "$500" },
    { biz: "Coastline HVAC", agent: "Sam", status: "Closed", cls: "bg-closed-bg text-closed-fg", price: "$1,200" },
    { biz: "Northgate Law", agent: "Erick", status: "Dropped", cls: "bg-dropped-bg text-dropped-fg", price: "$0" },
  ];

  return (
    <div className="rounded-xl border border-border bg-surface shadow-[0_30px_80px_-30px_rgba(20,27,45,0.35)] overflow-hidden">
      {/* browser chrome */}
      <div className="h-9 border-b border-border bg-surface-2 flex items-center gap-1.5 px-3.5">
        <span className="w-2.5 h-2.5 rounded-full bg-dropped-fg/40" />
        <span className="w-2.5 h-2.5 rounded-full bg-notready-fg/40" />
        <span className="w-2.5 h-2.5 rounded-full bg-ready-fg/40" />
        <span className="ml-3 text-[10px] font-mono text-text-faint">app.sedsolutions.online/dashboard</span>
      </div>

      <div className="flex min-h-[300px]">
        {/* sidebar */}
        <div className="w-40 shrink-0 border-r border-border bg-surface-2 p-3 hidden sm:block">
          <div className="flex items-center gap-2 px-1 pb-4">
            <BrandMark
              companyName={companyName}
              logoUrl={logoUrl}
              size={24}
              textClassName="text-[13px] font-semibold text-text"
            />
          </div>
          {["Dashboard", "Leads", "By Agent"].map((n, i) => (
            <div
              key={n}
              className={
                "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] mb-0.5 " +
                (i === 0 ? "bg-accent-soft text-accent-ink font-medium" : "text-text-muted")
              }
            >
              <span className={"w-1.5 h-1.5 rounded-full " + (i === 0 ? "bg-accent" : "bg-border")} />
              {n}
            </div>
          ))}
          <div className="px-2.5 pt-3 pb-1 text-[9px] uppercase tracking-wider text-text-faint">Admin</div>
          {["Users", "Departments"].map((n) => (
            <div key={n} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] text-text-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-border" />
              {n}
            </div>
          ))}
        </div>

        {/* main */}
        <div className="flex-1 p-4 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold text-text">Dashboard</div>
            <div className="text-[10px] font-semibold text-white bg-accent rounded-md px-2.5 py-1">+ New Lead</div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-4 border border-border rounded-lg overflow-hidden bg-surface mb-3">
            {[
              { l: "Total", v: "247", d: "+12" },
              { l: "Ready", v: "38", d: "15%" },
              { l: "Quoted", v: "86k", d: "+9k" },
              { l: "Rating", v: "6.8", d: "/8" },
            ].map((k, i) => (
              <div key={k.l} className={"p-2.5 " + (i < 3 ? "border-r border-border-subtle" : "")}>
                <div className="text-[9px] uppercase tracking-wide text-text-faint">{k.l}</div>
                <div className="text-[16px] font-semibold text-text font-mono leading-tight">{k.v}</div>
                <div className="text-[9px] text-accent font-mono">{k.d}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.3fr] gap-3">
            {/* chart */}
            <div className="border border-border rounded-lg p-3 bg-surface">
              <div className="text-[11px] font-semibold text-text mb-2.5">By Agent</div>
              <div className="flex items-end gap-2 h-[70px]">
                {bars.map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-sm bg-accent/85" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
            {/* table */}
            <div className="border border-border rounded-lg p-3 bg-surface">
              <div className="text-[11px] font-semibold text-text mb-2">Recent Leads</div>
              <table className="w-full">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.biz} className="border-b border-border-subtle last:border-0">
                      <td className="py-1.5 text-[11px] text-text">{r.biz}</td>
                      <td className="py-1.5 text-[10px] text-text-faint hidden sm:table-cell">{r.agent}</td>
                      <td className="py-1.5">
                        <span className={"text-[9px] font-medium px-1.5 py-0.5 rounded-full " + r.cls}>{r.status}</span>
                      </td>
                      <td className="py-1.5 text-[10px] text-text-muted font-mono text-right">{r.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
