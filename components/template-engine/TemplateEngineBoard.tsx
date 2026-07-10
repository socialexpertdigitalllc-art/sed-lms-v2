"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Circle,
  ExternalLink,
  Download,
  Rocket,
  Play,
} from "lucide-react";
import type { GenStep, TemplateManifest } from "@/lib/template-engine/types";
import { createClient } from "@/lib/supabase/client";
import { Select } from "@/components/common/Select";
import { useToast } from "@/components/common/Toast";
import { RelativeTime } from "@/components/common/RelativeTime";
import { inputCls } from "@/components/forms/Field";

export type LeadOption = {
  id: string;
  business_name: string;
  services: string[] | null;
  service_areas: string[] | null;
  image_links: string[] | null;
  status: string;
};

export type TemplateOption = {
  id: string;
  name: string;
  manifest: TemplateManifest;
  page_count: number;
};

type GenStatus = "queued" | "running" | "ready_for_review" | "deployed" | "failed";

type GenerationRow = {
  id: string;
  lead_id: string;
  template_id: string;
  tool: string;
  model: string;
  requested_pages: string[];
  status: GenStatus;
  current_step: string | null;
  steps: GenStep[];
  estimate_ms: number | null;
  total_ms: number | null;
  tokens_used: number;
  cost_usd: number;
  pages_built: number;
  images_used: number;
  ops_applied: number;
  ops_missed: number;
  site_slug: string | null;
  deployed_url: string | null;
  error: string | null;
  created_at: string;
  template_name: string | null;
  business_name: string | null;
};

const ENGINE_MODELS: Record<"webcraft" | "deepseek", string[]> = {
  webcraft: ["moonshot-v1-128k", "kimi-k2-0711-preview", "moonshot-v1-32k"],
  deepseek: ["deepseek-chat"],
};
const TOOL_LABELS: Record<"webcraft" | "deepseek", string> = {
  webcraft: "WebCraft",
  deepseek: "DeepSeek",
};

const STATUS_PILL: Record<GenStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-surface-2 text-text-muted" },
  running: { label: "Running", cls: "bg-accent-soft text-accent-ink" },
  ready_for_review: { label: "Ready for review", cls: "bg-notready-bg text-notready-fg" },
  deployed: { label: "Deployed", cls: "bg-ready-bg text-ready-fg" },
  failed: { label: "Failed", cls: "bg-dropped-bg text-dropped-fg" },
};

function StatusPill({ status }: { status: GenStatus }) {
  const p = STATUS_PILL[status] ?? STATUS_PILL.queued;
  return (
    <span className={"text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap " + p.cls}>
      {p.label}
    </span>
  );
}

function StepIcon({ status }: { status: GenStep["status"] }) {
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-ready-fg shrink-0" />;
  if (status === "running") return <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />;
  if (status === "partial") return <AlertTriangle className="w-4 h-4 text-notready-fg shrink-0" />;
  if (status === "failed") return <AlertTriangle className="w-4 h-4 text-dropped-fg shrink-0" />;
  return <Circle className="w-4 h-4 text-text-faint shrink-0" />;
}

function fmtSecs(ms: number | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${(n / 1000).toFixed(1)}s`;
}

function fmtCost(n: number): string {
  return "$" + (n >= 1 ? n.toFixed(2) : n.toFixed(3));
}

function entryFile(gen: GenerationRow): string {
  const pages = Array.isArray(gen.requested_pages) ? gen.requested_pages : [];
  return pages.find((p) => /index|home/i.test(p)) ?? pages[0] ?? "index.html";
}

function Card({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold">{title}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function TemplateEngineBoard({
  leads,
  templates,
  canDeploy,
}: {
  leads: LeadOption[];
  templates: TemplateOption[];
  canDeploy: boolean;
}) {
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<"generate" | "analytics">("generate");

  // ---- generate form ----
  const [leadId, setLeadId] = useState<string>(() => {
    const fromUrl = searchParams.get("lead");
    if (fromUrl && leads.some((l) => l.id === fromUrl)) return fromUrl;
    return leads[0]?.id ?? "";
  });
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const p of templates[0]?.manifest?.pages ?? []) init[p.file] = true;
    return init;
  });
  const [tool, setTool] = useState<"webcraft" | "deepseek">("webcraft");
  const [model, setModel] = useState<string>(ENGINE_MODELS.webcraft[0]);
  const [submitting, setSubmitting] = useState(false);

  // ---- tracker + runs ----
  const [activeGenId, setActiveGenId] = useState<string | null>(null);
  const [gen, setGen] = useState<GenerationRow | null>(null);
  const [runs, setRuns] = useState<GenerationRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [rtTick, setRtTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const selectedLead = leads.find((l) => l.id === leadId);
  const selectedTemplate = templates.find((t) => t.id === templateId);
  const manifestPages = useMemo(
    () => selectedTemplate?.manifest?.pages ?? [],
    [selectedTemplate]
  );

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    const next: Record<string, boolean> = {};
    for (const p of t?.manifest?.pages ?? []) next[p.file] = true;
    setChecked(next);
  }

  function pickTool(t: "webcraft" | "deepseek") {
    setTool(t);
    setModel(ENGINE_MODELS[t][0]);
  }

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/template-engine/generations");
      if (!res.ok) return;
      const rows = ((await res.json()).generations ?? []) as GenerationRow[];
      setRuns(rows);
      // auto-focus the newest in-flight run when nothing is selected yet
      setActiveGenId((cur) => {
        if (cur) return cur;
        const active = rows.find((r) => r.status === "queued" || r.status === "running");
        return active ? active.id : cur;
      });
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const loadGen = useCallback(async (id: string) => {
    const res = await fetch(`/api/template-engine/generations/${id}`);
    if (!res.ok) return;
    setGen(((await res.json()).generation ?? null) as GenerationRow | null);
  }, []);

  // initial load + refresh on realtime tick
  useEffect(() => {
    loadRuns();
  }, [loadRuns, rtTick]);

  useEffect(() => {
    if (activeGenId) loadGen(activeGenId);
  }, [activeGenId, rtTick, loadGen]);

  // Realtime: template_generations is in the supabase_realtime publication —
  // same subscribe pattern as BellBase (setAuth + postgres_changes, debounced).
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel("rt-template-generations");

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "template_generations" }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => setRtTick((n) => n + 1), 400);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, []);

  // 1s tick for the ETA line while a tracked run is in flight
  const genInFlight = !!gen && (gen.status === "queued" || gen.status === "running");
  useEffect(() => {
    if (!genInFlight) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [genInFlight]);

  async function generate() {
    const pages = manifestPages.filter((p) => checked[p.file]).map((p) => p.file);
    if (!leadId || !templateId) {
      toast({ kind: "error", title: "Pick a lead and a template first" });
      return;
    }
    if (pages.length === 0) {
      toast({ kind: "error", title: "Select at least one page to build" });
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/template-engine/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, templateId, pages, tool, model }),
    });
    setSubmitting(false);
    const j = await res.json().catch(() => ({}));
    if (res.status !== 201) {
      toast({ kind: "error", title: "Could not start generation", body: j.error ?? undefined });
      return;
    }
    setGen(null);
    setActiveGenId(j.id as string);
    toast({ kind: "success", title: "Generation queued", body: "Tracking it live below." });
    loadRuns();
  }

  async function deploy(g: GenerationRow) {
    if (!confirm("Deploy to a new subdomain and save the link to the lead?")) return;
    setDeploying(true);
    try {
      const res = await fetch(`/api/template-engine/generations/${g.id}/deploy`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Deploy failed", body: j.error ?? undefined });
        return;
      }
      toast({ kind: "success", title: `Deployed: ${j.url}` });
    } finally {
      setDeploying(false);
      loadGen(g.id);
      loadRuns();
    }
  }

  // ---- analytics (client-side over the fetched runs) ----
  const analytics = useMemo(() => {
    const finished = runs.filter((r) => ["ready_for_review", "deployed", "failed"].includes(r.status));
    const succeeded = finished.filter((r) => r.status !== "failed");
    const withDur = runs.filter((r) => Number(r.total_ms) > 0);
    const withPages = runs.filter((r) => Number(r.total_ms) > 0 && Number(r.pages_built) > 0);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

    const avgDurMs = avg(withDur.map((r) => Number(r.total_ms)));
    const avgPerPageMs = avg(withPages.map((r) => Number(r.total_ms) / Number(r.pages_built)));
    const totalCost = runs.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    const imagesUsed = runs.reduce((s, r) => s + Number(r.images_used || 0), 0);

    const groupBy = (key: (r: GenerationRow) => string) => {
      const m = new Map<string, { count: number; durs: number[] }>();
      for (const r of runs) {
        const k = key(r);
        const g = m.get(k) ?? { count: 0, durs: [] };
        g.count += 1;
        if (Number(r.total_ms) > 0) g.durs.push(Number(r.total_ms));
        m.set(k, g);
      }
      return [...m.entries()]
        .map(([name, g]) => ({ name, count: g.count, avgMs: avg(g.durs) }))
        .sort((a, b) => b.count - a.count);
    };

    return {
      total: runs.length,
      successRate: finished.length ? (succeeded.length / finished.length) * 100 : null,
      avgDurMs,
      avgPerPageMs,
      totalCost,
      imagesUsed,
      byTemplate: groupBy((r) => r.template_name ?? "—"),
      byTool: groupBy((r) => TOOL_LABELS[r.tool as "webcraft" | "deepseek"] ?? r.tool),
    };
  }, [runs]);

  // ---- ETA ----
  const eta = (() => {
    if (!gen || !genInFlight) return null;
    const elapsed = now - new Date(gen.created_at).getTime();
    const remaining = Math.max(Number(gen.estimate_ms ?? 0) - elapsed, 5000);
    return Math.round(remaining / 1000);
  })();

  const steps: GenStep[] = Array.isArray(gen?.steps) ? gen.steps : [];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Template Engine</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Build a full website from a template for a lead, track it live, then review and deploy.
          </p>
        </div>
        <div className="flex gap-1">
          {(["generate", "analytics"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                "text-sm px-3 py-1.5 rounded-md font-medium " +
                (tab === t ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")
              }
            >
              {t === "generate" ? "Generate" : "Analytics"}
            </button>
          ))}
        </div>
      </div>

      {tab === "generate" && (
        <div className="space-y-5">
          {/* Generate card */}
          <Card title="Generate a website">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Lead</label>
                <Select value={leadId} onChange={(e) => setLeadId(e.target.value)} className={inputCls}>
                  {leads.length === 0 && <option value="">No leads available</option>}
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.business_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Template</label>
                <Select value={templateId} onChange={(e) => pickTemplate(e.target.value)} className={inputCls}>
                  {templates.length === 0 && <option value="">No active templates</option>}
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.page_count} pages)
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {manifestPages.length > 0 && (
              <div className="mb-4">
                <label className="block text-xs font-medium text-text-muted mb-1.5">Pages to build</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
                  {manifestPages.map((p) => {
                    const isServiceDetail = p.kind === "service_detail";
                    const isAreaDetail = p.kind === "area_detail";
                    const n = isServiceDetail
                      ? selectedLead?.services?.length ?? 0
                      : selectedLead?.service_areas?.length ?? 0;
                    return (
                      <label key={p.file} className="flex flex-wrap items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="accent-accent w-4 h-4"
                          checked={!!checked[p.file]}
                          onChange={(e) => setChecked((c) => ({ ...c, [p.file]: e.target.checked }))}
                        />
                        <span className="text-text">{p.title}</span>
                        <span className="text-xs text-text-faint">({p.kind})</span>
                        {(isServiceDetail || isAreaDetail) && checked[p.file] && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent-soft text-accent-ink whitespace-nowrap">
                            × {n} {isServiceDetail ? "services" : "areas"} from the lead
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Tool</label>
                <Select
                  value={tool}
                  onChange={(e) => pickTool(e.target.value as "webcraft" | "deepseek")}
                  className={inputCls + " w-40"}
                >
                  <option value="webcraft">WebCraft</option>
                  <option value="deepseek">DeepSeek</option>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Model</label>
                <Select value={model} onChange={(e) => setModel(e.target.value)} className={inputCls + " w-56"}>
                  {ENGINE_MODELS[tool].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                onClick={generate}
                disabled={submitting || leads.length === 0 || templates.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60 whitespace-nowrap"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {submitting ? "Starting…" : "Generate"}
              </button>
            </div>
          </Card>

          {/* Live tracker */}
          {activeGenId && gen && (
            <Card
              title="Live tracker"
              actions={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">
                    {gen.business_name ?? "—"} · {gen.template_name ?? "—"}
                  </span>
                  <StatusPill status={gen.status} />
                </div>
              }
            >
              {steps.length === 0 ? (
                <div className="text-sm text-text-faint py-2">Waiting for the runner to pick this up…</div>
              ) : (
                <div className="space-y-0.5">
                  {steps.map((s) => (
                    <div key={s.key} className="flex items-start gap-2.5 py-1.5">
                      <div className="mt-0.5">
                        <StepIcon status={s.status} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span
                            className={
                              "text-sm " +
                              (s.status === "pending" ? "text-text-faint" : "font-medium text-text")
                            }
                          >
                            {s.label}
                          </span>
                          {typeof s.ms === "number" && (
                            <span className="text-[11px] font-mono text-text-faint">({fmtSecs(s.ms)})</span>
                          )}
                        </div>
                        {s.detail && <div className="text-xs text-text-muted break-words">{s.detail}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {eta !== null && (
                <div className="mt-3 text-sm text-accent-ink font-medium">≈ {eta}s remaining</div>
              )}

              {gen.status === "failed" && gen.error && (
                <div className="mt-3 text-sm text-dropped-fg break-words">{gen.error}</div>
              )}

              {(gen.status === "ready_for_review" || gen.status === "deployed") && (
                <div className="mt-3 text-xs text-text-muted">
                  {gen.pages_built} pages · {gen.images_used} images · {gen.ops_applied} ops applied
                  {Number(gen.ops_missed) > 0 ? ` · ${gen.ops_missed} missed` : ""} ·{" "}
                  {Number(gen.tokens_used).toLocaleString()} tokens · {fmtCost(Number(gen.cost_usd || 0))}
                </div>
              )}

              {gen.status === "ready_for_review" && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <a
                    href={`/api/template-engine/preview/${gen.id}/${entryFile(gen)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-2"
                  >
                    <ExternalLink className="w-4 h-4" /> Preview
                  </a>
                  <a
                    href={`/api/template-engine/generations/${gen.id}/download`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-2"
                  >
                    <Download className="w-4 h-4" /> Download ZIP
                  </a>
                  {canDeploy && (
                    <button
                      type="button"
                      onClick={() => deploy(gen)}
                      disabled={deploying}
                      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60"
                    >
                      {deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                      {deploying ? "Deploying…" : "Approve & Deploy"}
                    </button>
                  )}
                </div>
              )}

              {gen.status === "deployed" && gen.deployed_url && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <a
                    href={gen.deployed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-ink hover:underline"
                  >
                    <ExternalLink className="w-4 h-4" /> {gen.deployed_url}
                  </a>
                  <a
                    href={`/api/template-engine/generations/${gen.id}/download`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-2"
                  >
                    <Download className="w-4 h-4" /> Download ZIP
                  </a>
                </div>
              )}
            </Card>
          )}

          {/* Runs table */}
          <Card title="Recent runs">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-text-faint">
                    <th className="py-2 pr-3">#</th>
                    <th className="pr-3">Created</th>
                    <th className="pr-3">Business</th>
                    <th className="pr-3">Template</th>
                    <th className="pr-3">Tool</th>
                    <th className="pr-3">Status</th>
                    <th className="pr-3">Duration</th>
                    <th className="pr-3">Pages</th>
                  </tr>
                </thead>
                <tbody>
                  {runsLoading ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-text-faint">
                        Loading runs…
                      </td>
                    </tr>
                  ) : runs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-text-faint">
                        No runs yet — start one above.
                      </td>
                    </tr>
                  ) : (
                    runs.map((r, i) => (
                      <tr
                        key={r.id}
                        onClick={() => setActiveGenId(r.id)}
                        className={
                          "border-t border-border-subtle cursor-pointer hover:bg-surface-2 " +
                          (r.id === activeGenId ? "bg-accent-soft/40" : "")
                        }
                      >
                        <td className="py-2 pr-3 text-text-faint text-xs tabular-nums">{i + 1}</td>
                        <td className="pr-3 text-text-faint text-xs whitespace-nowrap">
                          <RelativeTime iso={r.created_at} />
                        </td>
                        <td className="pr-3 font-medium text-text">{r.business_name ?? "—"}</td>
                        <td className="pr-3 text-text-muted">{r.template_name ?? "—"}</td>
                        <td className="pr-3 text-text-muted font-mono text-xs">
                          {TOOL_LABELS[r.tool as "webcraft" | "deepseek"] ?? r.tool}
                        </td>
                        <td className="pr-3">
                          <StatusPill status={r.status} />
                        </td>
                        <td className="pr-3 font-mono text-xs text-text-muted">{fmtSecs(r.total_ms)}</td>
                        <td className="pr-3 font-mono text-xs text-text-muted">{r.pages_built}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "analytics" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { label: "Total Runs", value: String(analytics.total), sub: "last 50" },
              {
                label: "Success Rate",
                value: analytics.successRate === null ? "—" : `${Math.round(analytics.successRate)}%`,
                sub: "of finished runs",
              },
              {
                label: "Avg Duration",
                value: analytics.avgDurMs === null ? "—" : fmtSecs(analytics.avgDurMs),
                sub: "per run",
              },
              {
                label: "Avg Per Page",
                value: analytics.avgPerPageMs === null ? "—" : fmtSecs(analytics.avgPerPageMs),
                sub: "build time",
              },
              { label: "Total Cost", value: fmtCost(analytics.totalCost), sub: "AI spend" },
              { label: "Images Used", value: String(analytics.imagesUsed), sub: "stock photos" },
            ].map((t) => (
              <div key={t.label} className="bg-surface border border-border rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wide text-text-faint">{t.label}</div>
                <div className="text-lg font-semibold text-text mt-1">{t.value}</div>
                <div className="text-xs text-text-muted mt-0.5">{t.sub}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {(
              [
                { title: "By template", rows: analytics.byTemplate, head: "Template" },
                { title: "By tool", rows: analytics.byTool, head: "Tool" },
              ] as const
            ).map((section) => (
              <Card key={section.title} title={section.title}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-text-faint">
                      <th className="py-2 pr-3">{section.head}</th>
                      <th className="pr-3">Runs</th>
                      <th className="pr-3">Avg duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-text-faint">
                          No runs yet.
                        </td>
                      </tr>
                    ) : (
                      section.rows.map((r) => (
                        <tr key={r.name} className="border-t border-border-subtle">
                          <td className="py-2 pr-3 font-medium text-text">{r.name}</td>
                          <td className="pr-3 font-mono text-xs text-text-muted">{r.count}</td>
                          <td className="pr-3 font-mono text-xs text-text-muted">
                            {r.avgMs === null ? "—" : fmtSecs(r.avgMs)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
