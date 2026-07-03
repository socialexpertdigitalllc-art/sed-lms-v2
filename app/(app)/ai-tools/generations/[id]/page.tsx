import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TOOLS } from "@/lib/ai-tools/config";
import { formatDateTime } from "@/lib/leads/format";
import { PreviewPane } from "@/components/ai-tools/PreviewPane";
import type { AiGeneration } from "@/lib/ai-tools/types";
import type { GeneratedFile } from "@/lib/ai-tools/parse";

const BUCKET = "ai-generations";

export default async function GenerationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes which rows the user can read.
  const { data } = await supabase.from("ai_generations").select("*").eq("id", id).single();
  if (!data) notFound();
  const gen = data as AiGeneration;

  // Pull the saved files from storage via the service role.
  const admin = createAdminClient();
  const files: GeneratedFile[] = [];
  const { data: list } = await admin.storage.from(BUCKET).list(id, { limit: 100 });
  for (const obj of list ?? []) {
    const { data: blob } = await admin.storage.from(BUCKET).download(`${id}/${obj.name}`);
    if (blob) files.push({ name: obj.name, code: await blob.text() });
  }
  // Show index.html first.
  files.sort((a, b) => (a.name === "index.html" ? -1 : b.name === "index.html" ? 1 : a.name.localeCompare(b.name)));

  const cfg = TOOLS[gen.tool];
  const meta: [string, string][] = [
    ["Tool", cfg?.label ?? gen.tool],
    ["Model", gen.model ?? "—"],
    ["Files", String(gen.num_files ?? files.length)],
    ["Tokens", (gen.tokens_used ?? 0).toLocaleString()],
    ["Cost", `$${Number(gen.cost_usd ?? 0).toFixed(4)}`],
    ["Time", gen.total_time_ms ? `${(gen.total_time_ms / 1000).toFixed(1)}s` : "—"],
    ["Status", gen.status ?? "—"],
    ["Created", formatDateTime(gen.created_at)],
  ];

  return (
    <div>
      <Link href="/ai-tools/analytics" className="text-xs text-text-muted hover:text-text">← AI Tools analytics</Link>
      <div className="flex items-center gap-2 mt-2 mb-4">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: cfg?.accent ?? "#888" }} />
        <h1 className="text-xl font-semibold text-text truncate">{gen.business_name ?? "Untitled generation"}</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-5">
        {meta.map(([k, v]) => (
          <div key={k} className="bg-surface border border-border rounded-lg px-3 py-2">
            <div className="text-[9px] uppercase tracking-wide text-text-faint font-semibold">{k}</div>
            <div className="text-sm text-text font-mono truncate mt-0.5">{v}</div>
          </div>
        ))}
      </div>

      {files.length ? (
        <PreviewPane files={files} />
      ) : (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint text-sm">
          No stored files for this generation.
        </div>
      )}
    </div>
  );
}
