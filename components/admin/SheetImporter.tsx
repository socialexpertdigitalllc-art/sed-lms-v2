"use client";

import { useState } from "react";
import { IMPORT_TARGETS } from "@/lib/import/columns";
import type { ImportConfig } from "@/lib/import/config";

type Preview = { total: number; valid: number; invalid: number; dup: number; newCount: number; sample: { business_name: string; status: string; agent: string | null; agentMatched: boolean; dup: boolean }[] };
const inputCls = "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";

export function SheetImporter({ initialConfig }: { initialConfig: ImportConfig }) {
  const [sheetId, setSheetId] = useState(initialConfig.sheet_id);
  const [tab, setTab] = useState(initialConfig.sheet_tab);
  const [mapping, setMapping] = useState<Record<string, string>>(initialConfig.mapping);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const letters = Object.keys(mapping).sort((a, b) => (a.length - b.length) || a.localeCompare(b));

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true); setMsg(null);
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    setBusy(false);
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok, j };
  }

  async function saveMapping() {
    const { ok, j } = await call("/api/admin/import/config", "PUT", { sheet_id: sheetId, sheet_tab: tab, mapping });
    setMsg(ok ? { ok: true, text: "Mapping saved" } : { ok: false, text: j.error ?? "Save failed" });
  }
  async function doPreview() {
    const { ok, j } = await call("/api/admin/import/preview", "POST", { sheetId, tab, mapping });
    if (ok) { setPreview(j as Preview); setMsg(null); } else { setPreview(null); setMsg({ ok: false, text: j.error ?? "Preview failed" }); }
  }
  async function doImport() {
    if (!confirm("Import new leads from this sheet?")) return;
    const { ok, j } = await call("/api/admin/import/run", "POST", { sheetId, tab, mapping });
    setMsg(ok ? { ok: true, text: `Imported ${j.imported}, skipped ${j.skipped}` } : { ok: false, text: j.error ?? "Import failed" });
    if (ok) doPreview();
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text">Import leads from Google Sheets</h1>
        <p className="text-sm text-text-muted mt-0.5">The sheet must be shared with the service account. Edit the column mapping, preview, then import (duplicates by business name + phone are skipped).</p>
      </div>

      {msg && <div className={"mb-4 text-sm rounded-md px-3 py-2 " + (msg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>{msg.text}</div>}

      <div className="bg-surface border border-border rounded-lg p-5 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="block text-xs font-medium text-text-muted mb-1">Spreadsheet ID</label><input value={sheetId} onChange={(e) => setSheetId(e.target.value)} className={inputCls} /></div>
        <div><label className="block text-xs font-medium text-text-muted mb-1">Tab name</label><input value={tab} onChange={(e) => setTab(e.target.value)} className={inputCls} /></div>
      </div>

      <div className="bg-surface border border-border rounded-lg p-5 mb-5">
        <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-4">Column mapping</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {letters.map((L) => (
            <div key={L} className="flex items-center gap-2">
              <span className="font-mono text-xs text-text-faint w-8">{L}</span>
              <select value={mapping[L]} onChange={(e) => setMapping((m) => ({ ...m, [L]: e.target.value }))} className={inputCls}>
                {IMPORT_TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        <button onClick={saveMapping} disabled={busy} className="text-sm px-3 py-2 rounded-md border border-border text-text-muted hover:bg-surface-2">Save mapping</button>
        <button onClick={doPreview} disabled={busy} className="text-sm px-4 py-2 rounded-md border border-border text-text hover:bg-surface-2">{busy ? "Working…" : "Preview"}</button>
        <button onClick={doImport} disabled={busy || !preview} className="text-sm px-4 py-2 rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60">Import {preview ? `${preview.newCount} new` : ""}</button>
      </div>

      {preview && (
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="flex gap-4 text-sm mb-4 flex-wrap">
            <span className="text-text-muted">Total: <b className="text-text font-mono">{preview.total}</b></span>
            <span className="text-text-muted">Valid: <b className="text-text font-mono">{preview.valid}</b></span>
            <span className="text-text-muted">New: <b className="text-ready-fg font-mono">{preview.newCount}</b></span>
            <span className="text-text-muted">Dupes: <b className="text-notready-fg font-mono">{preview.dup}</b></span>
            <span className="text-text-muted">Invalid: <b className="text-dropped-fg font-mono">{preview.invalid}</b></span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase tracking-wide text-text-faint"><th className="py-2 pr-3">Business</th><th className="pr-3">Status</th><th className="pr-3">Agent</th><th className="pr-3"></th></tr></thead>
            <tbody>
              {preview.sample.map((r, i) => (
                <tr key={i} className="border-t border-border-subtle">
                  <td className="py-1.5 pr-3 text-text">{r.business_name}</td>
                  <td className="pr-3 text-text-muted">{r.status}</td>
                  <td className="pr-3 text-text-muted">{r.agent ?? "—"}{r.agent && !r.agentMatched && <span className="ml-1 text-[11px] text-notready-fg">(unmatched)</span>}</td>
                  <td className="pr-3">{r.dup && <span className="text-[11px] text-notready-fg">duplicate</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
