import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { TOOLS, TOOL_IDS } from "@/lib/ai-tools/config";
import { formatDateTime } from "@/lib/leads/format";
import type { AiGeneration } from "@/lib/ai-tools/types";
import { ArrowRight } from "lucide-react";

export default async function AiToolsOverview() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  const canAnalytics = perms.has("analytics.view_webcraft") || perms.has("analytics.view_deepseek") || perms.has("analytics.view_all_agents");

  const { data: recentData } = await supabase
    .from("ai_generations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(6);
  const recent = (recentData ?? []) as AiGeneration[];

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text">AI Tools</h1>
        <p className="text-sm text-text-muted mt-0.5">Generate complete multi-page websites from a lead's details.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {TOOL_IDS.map((id) => {
          const cfg = TOOLS[id];
          const allowed = perms.has(cfg.perm);
          return (
            <div key={id} className="bg-surface border border-border rounded-lg p-5 flex flex-col">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: cfg.accent }} />
                <h2 className="font-semibold text-text">{cfg.label}</h2>
              </div>
              <p className="text-sm text-text-muted flex-1">{cfg.blurb}</p>
              <div className="mt-4">
                {allowed ? (
                  <Link href={`/ai-tools/${id}`} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-accent text-white font-semibold hover:bg-accent-ink">
                    Open generator <ArrowRight className="w-4 h-4" />
                  </Link>
                ) : (
                  <span className="inline-block text-sm px-4 py-2 rounded-md border border-border text-text-faint cursor-not-allowed">
                    No access
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold">Recent generations</div>
        {canAnalytics && (
          <Link href="/ai-tools/analytics" className="inline-flex items-center gap-1 text-xs text-accent-ink hover:underline">
            View analytics <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
      <div className="bg-surface border border-border rounded-lg divide-y divide-border-subtle">
        {recent.length === 0 ? (
          <div className="px-4 py-10 text-center text-text-faint text-sm">No generations yet.</div>
        ) : (
          recent.map((r) => (
            <Link key={r.id} href={`/ai-tools/generations/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TOOLS[r.tool]?.accent ?? "#888" }} />
              <span className="font-medium text-text truncate flex-1">{r.business_name ?? "Untitled"}</span>
              <span className="text-xs text-text-faint font-mono hidden sm:inline">{r.num_files ?? 0} files</span>
              <span className="text-xs text-text-muted whitespace-nowrap">{formatDateTime(r.created_at)}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
