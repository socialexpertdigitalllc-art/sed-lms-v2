"use client";

import { useState, useEffect } from "react";
import type { WgeConfig, WgeVariable } from "@/lib/ai-tools/wge-types";
import { TOOLS, TOOL_IDS } from "@/lib/ai-tools/config";
import { listTemplateVars } from "@/lib/ai-tools/template";
import { buildPrompt, EMPTY_INPUT, type GenInput } from "@/lib/ai-tools/prompt";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

type Lead = { id: string; business_name: string };
type Tab = "prompt" | "variables" | "settings" | "queue";
const DERIVED = ["references", "ref_count", "experience", "page_names"];
const inputCls = "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";

export function WgeControl({ initialConfig, leads }: { initialConfig: WgeConfig; leads: Lead[] }) {
  const [tab, setTab] = useState<Tab>("prompt");
  useRealtimeRefresh("wge_queue");
  const [cfg, setCfg] = useState<WgeConfig>(initialConfig);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testLead, setTestLead] = useState<string>(leads[0]?.id ?? "");
  const [testOut, setTestOut] = useState<string>("");

  type QueueRow = {
    id: string; lead_id: string; tool: string; model: string; status: string; attempts: number;
    generation_id: string | null; error: string | null; created_at: string; finished_at: string | null;
    leads: { business_name: string } | null;
  };
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);

  async function loadQueue() {
    setQueueBusy(true);
    const res = await fetch("/api/ai-tools/wge/queue");
    setQueueBusy(false);
    if (res.ok) setQueue((await res.json()).items ?? []);
  }
  useEffect(() => {
    if (tab === "queue") loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function retryRow(id: string) { await fetch(`/api/ai-tools/wge/queue/${id}/retry`, { method: "POST" }); loadQueue(); }
  async function cancelRow(id: string) { await fetch(`/api/ai-tools/wge/queue/${id}`, { method: "DELETE" }); loadQueue(); }

  const definedKeys = new Set([...cfg.variables.map((v) => v.key), ...DERIVED]);
  const usedVars = listTemplateVars(cfg.prompt_template);
  const unmapped = usedVars.filter((k) => !definedKeys.has(k));

  async function save() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/ai-tools/wge", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Save failed" }); return; }
    setMsg({ ok: true, text: "Saved — affects all future generations." });
  }

  async function reset() {
    if (!confirm("Reset the WGE config to built-in defaults? This overwrites your prompt and mappings.")) return;
    setBusy(true); setMsg(null);
    const res = await fetch("/api/ai-tools/wge/reset", { method: "POST" });
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: "Reset failed" }); return; }
    location.reload();
  }

  async function runTest() {
    const lead = leads.find((l) => l.id === testLead);
    if (!lead) return;
    const res = await fetch(`/api/ai-tools/prefill?lead=${testLead}`);
    const prefill = res.ok ? (await res.json()).fields : {};
    const values: GenInput = { ...EMPTY_INPUT, ...prefill };
    setTestOut(`SYSTEM:\n${cfg.system_prompt}\n\n---- USER ----\n${buildPrompt(values, cfg.prompt_template)}`);
  }

  const updateVar = (i: number, patch: Partial<WgeVariable>) =>
    setCfg((c) => ({ ...c, variables: c.variables.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text">Website Engine (WGE) Control</h1>
          <p className="text-sm text-text-muted mt-0.5">Edit the prompt, field mapping, and engine settings used by every generation.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} disabled={busy} className="text-sm px-3 py-2 rounded-md border border-border text-text-muted hover:bg-surface-2">Reset to defaults</button>
          <button onClick={save} disabled={busy} className="text-sm px-4 py-2 rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>

      {msg && <div className={"mb-4 text-sm rounded-md px-3 py-2 " + (msg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>{msg.text}</div>}

      <div className="flex gap-1 mb-4">
        {(["prompt", "variables", "settings", "queue"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={"text-sm px-3 py-1.5 rounded-md font-medium " + (tab === t ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>
            {t === "prompt" ? "Prompt Studio" : t === "variables" ? "Variables & Mapping" : t === "settings" ? "Engine Settings" : "Queue"}
          </button>
        ))}
      </div>

      {tab === "prompt" && (
        <div className="space-y-5">
          <Card title="System prompt">
            <textarea value={cfg.system_prompt} onChange={(e) => setCfg((c) => ({ ...c, system_prompt: e.target.value }))} rows={5} className={inputCls + " font-mono text-xs"} />
          </Card>
          <Card title="Prompt template">
            <div className="flex flex-wrap gap-1 mb-2">
              {[...cfg.variables.map((v) => v.key), ...DERIVED].map((k) => (
                <span key={k} className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-2 border border-border text-text-muted">{"{{" + k + "}}"}</span>
              ))}
            </div>
            {unmapped.length > 0 && (
              <div className="mb-2 text-xs text-notready-fg bg-notready-bg rounded px-2 py-1">Template uses undefined variables: {unmapped.join(", ")}</div>
            )}
            <textarea value={cfg.prompt_template} onChange={(e) => setCfg((c) => ({ ...c, prompt_template: e.target.value }))} rows={20} className={inputCls + " font-mono text-xs leading-relaxed"} />
          </Card>
          <Card title="Test render">
            <div className="flex gap-2 mb-3">
              <select value={testLead} onChange={(e) => setTestLead(e.target.value)} className={inputCls + " max-w-sm"}>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.business_name}</option>)}
              </select>
              <button onClick={runTest} className="text-sm px-3 py-2 rounded-md border border-border text-text hover:bg-surface-2 whitespace-nowrap">Render with this lead</button>
            </div>
            {testOut && <pre className="w-full max-h-[50vh] overflow-auto bg-[#0f1117] text-[#cdd3de] text-xs font-mono p-4 rounded-lg whitespace-pre-wrap">{testOut}</pre>}
          </Card>
        </div>
      )}

      {tab === "variables" && (
        <Card title="Variables & lead mapping">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-text-faint">
                <th className="py-2 pr-3">Key</th><th className="pr-3">Label</th><th className="pr-3">Type</th><th className="pr-3">Fallback</th><th className="pr-3">Lead column</th><th className="pr-3">Join</th>
              </tr></thead>
              <tbody>
                {cfg.variables.map((v, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-3 font-mono text-xs">{v.key}</td>
                    <td className="pr-3"><input value={v.label} onChange={(e) => updateVar(i, { label: e.target.value })} className={inputCls} /></td>
                    <td className="pr-3">
                      <select value={v.type} onChange={(e) => updateVar(i, { type: e.target.value as WgeVariable["type"] })} className={inputCls}>
                        {["text", "textarea", "number", "list"].map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="pr-3"><input value={v.fallback} onChange={(e) => updateVar(i, { fallback: e.target.value })} className={inputCls} /></td>
                    <td className="pr-3"><input value={v.lead_column ?? ""} placeholder="(none)" onChange={(e) => updateVar(i, { lead_column: e.target.value.trim() || null })} className={inputCls + " font-mono text-xs"} /></td>
                    <td className="pr-3"><input value={v.join === "\n" ? "\\n" : v.join} onChange={(e) => updateVar(i, { join: e.target.value === "\\n" ? "\n" : e.target.value })} className={inputCls + " w-16"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-faint mt-3">Keys are fixed identifiers used in the template. Edit labels, fallbacks, and which lead column each maps from.</p>
        </Card>
      )}

      {tab === "settings" && (
        <div className="space-y-5">
          <Card title="Generator defaults">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Labeled label="Default pages"><input type="number" value={cfg.settings.default_pages} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, default_pages: Number(e.target.value) } }))} className={inputCls} /></Labeled>
              <Labeled label="Max output tokens"><input type="number" value={cfg.settings.max_tokens} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, max_tokens: Number(e.target.value) } }))} className={inputCls} /></Labeled>
              <Labeled label={`Temperature: ${cfg.settings.temperature.toFixed(2)}`}><input type="range" min={0} max={1.5} step={0.05} value={cfg.settings.temperature} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, temperature: Number(e.target.value) } }))} className="w-full accent-accent" /></Labeled>
              <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={cfg.settings.auto_download} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, auto_download: e.target.checked } }))} /> Auto-download ZIP after a generation</label>
            </div>
          </Card>
          <Card title="Automation — auto-generate on lead submit">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-90">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.settings.auto_generate} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, auto_generate: e.target.checked } }))} /> Auto-generate when a lead is submitted</label>
              <Labeled label="Auto engine">
                <select value={cfg.settings.auto_engine ? `${cfg.settings.auto_engine.provider}:${cfg.settings.auto_engine.model}` : ""} onChange={(e) => {
                  const v = e.target.value;
                  setCfg((c) => ({ ...c, settings: { ...c.settings, auto_engine: v ? { provider: v.split(":")[0] as (typeof TOOL_IDS)[number], model: v.split(":").slice(1).join(":") } : null } }));
                }} className={inputCls}>
                  <option value="">(set later)</option>
                  {TOOL_IDS.flatMap((id) => TOOLS[id].models.map((m) => <option key={`${id}:${m}`} value={`${id}:${m}`}>{TOOLS[id].label} — {m}</option>))}
                </select>
              </Labeled>
              <Labeled label="Required fields before auto-queue">
                <div className="flex flex-wrap gap-1">
                  {cfg.variables.map((v) => {
                    const on = cfg.settings.ready_required.includes(v.key);
                    return (
                      <button key={v.key} type="button" onClick={() => setCfg((c) => ({ ...c, settings: { ...c.settings, ready_required: on ? c.settings.ready_required.filter((k) => k !== v.key) : [...c.settings.ready_required, v.key] } }))} className={"text-xs px-2 py-1 rounded-md border " + (on ? "bg-accent-soft text-accent-ink border-accent" : "border-border text-text-muted")}>{v.key}</button>
                    );
                  })}
                </div>
              </Labeled>
            </div>
          </Card>
        </div>
      )}

      {tab === "queue" && (
        <Card title="Generation queue">
          <div className="flex justify-end mb-3">
            <button onClick={loadQueue} disabled={queueBusy} className="text-sm px-3 py-1.5 rounded-md border border-border text-text-muted hover:bg-surface-2">{queueBusy ? "Loading…" : "Refresh"}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-text-faint">
                <th className="py-2 pr-3">Business</th><th className="pr-3">Engine</th><th className="pr-3">Status</th><th className="pr-3">Attempts</th><th className="pr-3">When</th><th className="pr-3"></th>
              </tr></thead>
              <tbody>
                {queue.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-text-faint">Queue is empty.</td></tr>
                ) : queue.map((r) => (
                  <tr key={r.id} className="border-t border-border-subtle align-top">
                    <td className="py-2 pr-3 font-medium text-text">{r.leads?.business_name ?? r.lead_id.slice(0, 8)}</td>
                    <td className="pr-3 text-text-muted font-mono text-xs">{r.tool}/{r.model}</td>
                    <td className="pr-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-medium " + (r.status === "done" ? "bg-ready-bg text-ready-fg" : r.status === "failed" ? "bg-dropped-bg text-dropped-fg" : r.status === "processing" ? "bg-notready-bg text-notready-fg" : "bg-surface-2 text-text-muted")}>{r.status}</span>
                      {r.error && <div className="text-[11px] text-dropped-fg mt-1 max-w-[260px]">{r.error}</div>}
                    </td>
                    <td className="pr-3 font-mono text-text-muted">{r.attempts}</td>
                    <td className="pr-3 text-text-faint text-xs whitespace-nowrap">{new Date(r.finished_at ?? r.created_at).toLocaleString()}</td>
                    <td className="pr-3 whitespace-nowrap">
                      {r.status === "done" && r.generation_id && <a href={`/ai-tools/generations/${r.generation_id}`} className="text-xs text-accent-ink hover:underline">View</a>}
                      {r.status === "failed" && <button onClick={() => retryRow(r.id)} className="text-xs text-accent-ink hover:underline">Retry</button>}
                      {r.status === "pending" && <button onClick={() => cancelRow(r.id)} className="text-xs text-dropped-fg hover:underline">Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-surface border border-border rounded-lg p-5"><div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-4">{title}</div>{children}</div>;
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-text-muted mb-1">{label}</label>{children}</div>;
}
