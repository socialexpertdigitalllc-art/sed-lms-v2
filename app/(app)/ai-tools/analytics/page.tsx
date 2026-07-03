import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { GenerationsTable } from "@/components/ai-tools/GenerationsTable";
import { GenerationsTrend, ToolDonut, CountBars } from "@/components/ai-tools/AiCharts";
import { computeAiKpis, byTool, byModel, generationsOverTime } from "@/lib/ai-tools/analytics";
import type { AiGeneration } from "@/lib/ai-tools/types";

const GATE = ["analytics.view_webcraft", "analytics.view_deepseek", "analytics.view_all_agents", "ai_tools.webcraft", "ai_tools.deepseek"];

export default async function AiAnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!GATE.some((p) => perms.has(p))) redirect("/dashboard");

  const { data: genData } = await supabase
    .from("ai_generations")
    .select("*")
    .order("created_at", { ascending: false });
  const rows = (genData ?? []) as AiGeneration[];

  const { data: profiles } = await supabase.from("profiles").select("id, display_name");
  const agentNameById: Record<string, string> = {};
  for (const p of profiles ?? []) agentNameById[p.id] = p.display_name ?? p.id;

  const kpis = computeAiKpis(rows);
  const trend = generationsOverTime(rows, 30);
  const tools = byTool(rows);
  const models = byModel(rows).slice(0, 6);

  const cards = [
    { label: "Generations", value: kpis.total.toLocaleString(), sub: `${kpis.success} ok · ${kpis.failed} failed` },
    { label: "Success rate", value: `${Math.round(kpis.successRate * 100)}%`, sub: "of completed runs" },
    { label: "Pages built", value: kpis.totalPages.toLocaleString(), sub: "across all runs" },
    { label: "Tokens used", value: kpis.totalTokens.toLocaleString(), sub: `~$${kpis.totalCost.toFixed(2)} est. cost` },
  ];

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text">AI Tools analytics</h1>
        <p className="text-sm text-text-muted mt-0.5">WebCraft & DeepSeek generation history and metrics</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {cards.map((c) => (
          <div key={c.label} className="bg-surface border border-border rounded-lg p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">{c.label}</div>
            <div className="text-3xl font-semibold text-text font-mono mt-2">{c.value}</div>
            <div className="text-xs mt-2 font-medium text-text-faint">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <ChartCard title="Generations over time" className="lg:col-span-2">
          <GenerationsTrend data={trend} />
        </ChartCard>
        <ChartCard title="By tool">
          {tools.length ? <ToolDonut data={tools} /> : <Empty />}
        </ChartCard>
        <ChartCard title="By model" className="lg:col-span-3">
          {models.length ? <CountBars data={models} /> : <Empty />}
        </ChartCard>
      </div>

      <div className="mb-2 text-[10px] uppercase tracking-wider text-text-faint font-semibold">History</div>
      <GenerationsTable rows={rows} agentNameById={agentNameById} />
    </div>
  );
}

function ChartCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={"bg-surface border border-border rounded-lg p-5 " + className}>
      <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-4">{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="h-[220px] grid place-items-center text-text-faint text-sm">No data yet</div>;
}
