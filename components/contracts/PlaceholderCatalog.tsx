"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Braces, Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/common/Panel";
import { CopyButton } from "@/components/common/CopyButton";
import { inputCls } from "@/components/forms/Field";
import { btnPrimary, iconBtnDanger } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import {
  BUILT_IN_PLACEHOLDERS,
  LEAD_FIELD_SOURCES,
  PLACEHOLDER_GROUPS,
  normalizeToken,
  isBuiltInToken,
  type ContractPlaceholderRow,
  type PlaceholderGroup,
} from "@/lib/contracts/placeholders";

const LEAD_FIELD_ENTRIES = Object.entries(LEAD_FIELD_SOURCES);

/** One reference row: monospace token, copy button, human label, optional action. */
function TokenRow({ token, label, action }: { token: string; label: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 px-4 py-2 transition-colors duration-150 hover:bg-surface-2">
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="truncate rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-muted ring-1 ring-inset ring-border-subtle">
          {token}
        </span>
        <CopyButton value={token} title={`Copy ${token}`} />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-text-muted" title={label}>
        {label}
      </span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </li>
  );
}

export function PlaceholderCatalog({ custom }: { custom: ContractPlaceholderRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<ContractPlaceholderRow[]>(custom);
  const [token, setToken] = useState("");
  const [leadField, setLeadField] = useState(LEAD_FIELD_ENTRIES[0]?.[0] ?? "business_name");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<PlaceholderGroup, typeof BUILT_IN_PLACEHOLDERS>();
    for (const g of PLACEHOLDER_GROUPS) map.set(g, []);
    for (const p of BUILT_IN_PLACEHOLDERS) map.get(p.group)?.push(p);
    return PLACEHOLDER_GROUPS.map((g) => ({ group: g, items: map.get(g) ?? [] })).filter((s) => s.items.length > 0);
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeToken(token);
    if (!normalized) {
      setError("Use letters, numbers and underscores only — e.g. owner_name.");
      return;
    }
    if (isBuiltInToken(normalized)) {
      setError(`${normalized} is already a built-in placeholder.`);
      return;
    }
    if (rows.some((r) => r.token === normalized)) {
      setError(`${normalized} is already registered.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/contract-placeholders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: normalized, lead_field: leadField }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not add that placeholder.");
        return;
      }
      setRows((prev) => [...prev, data.placeholder].sort((a, b) => a.token.localeCompare(b.token)));
      setToken("");
      toast({ kind: "success", title: "Placeholder added" });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: ContractPlaceholderRow) {
    if (!confirm(`Remove ${row.token}? Templates using it will render the token as-is.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/contract-placeholders/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        toast({ kind: "error", title: "Remove failed", body: d.error });
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast({ kind: "success", title: "Placeholder removed" });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel
      icon={Braces}
      title="Placeholders"
      description="Every token a template document can use. Copy one into your Google Doc and it gets filled at generation time."
      count={BUILT_IN_PLACEHOLDERS.length + rows.length}
      flush
    >
      {/* ── New custom placeholder ─────────────────────────────────── */}
      <form onSubmit={add} className="space-y-3 border-b border-border-subtle bg-surface-2/40 px-4 py-3">
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div>
            <label htmlFor="ph-token" className="mb-1 block text-xs font-medium text-text-muted">
              New placeholder
            </label>
            <div className="flex items-center rounded-md border border-border bg-surface focus-within:ring-2 focus-within:ring-accent">
              <span className="pl-2.5 font-mono text-xs text-text-faint">{"{{"}</span>
              <input
                id="ph-token"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="owner_name"
                className="min-w-0 flex-1 bg-transparent px-1.5 py-2 font-mono text-sm text-text outline-none"
              />
              <span className="pr-2.5 font-mono text-xs text-text-faint">{"}}"}</span>
            </div>
          </div>
          <div>
            <label htmlFor="ph-field" className="mb-1 block text-xs font-medium text-text-muted">
              Filled from lead field
            </label>
            <select
              id="ph-field"
              value={leadField}
              onChange={(e) => setLeadField(e.target.value)}
              className={cn(inputCls, "h-[38px] py-0")}
            >
              {LEAD_FIELD_ENTRIES.map(([key, def]) => (
                <option key={key} value={key}>
                  {def.label} ({def.kind})
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={saving} className={cn(btnPrimary, "h-[38px]")}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </div>
        {error ? (
          <p className="flex items-center gap-1 text-[11px] text-dropped-fg">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        ) : null}
      </form>

      {/* ── Reference list ─────────────────────────────────────────── */}
      <div className="divide-y divide-border-subtle">
        {grouped.map(({ group, items }) => (
          <div key={group}>
            <p className="bg-surface-2/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
              {group}
            </p>
            <ul className="divide-y divide-border-subtle">
              {items.map((p) => (
                <TokenRow key={p.token} token={p.token} label={p.label} />
              ))}
            </ul>
          </div>
        ))}

        <div>
          <p className="bg-surface-2/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            Custom
          </p>
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-xs leading-relaxed text-text-faint">
              No custom placeholders yet. Add one above to bind a token to any client-safe lead field.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((r) => (
                <TokenRow
                  key={r.id}
                  token={r.token}
                  label={LEAD_FIELD_SOURCES[r.lead_field]?.label ?? r.label ?? r.lead_field}
                  action={
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={busyId === r.id}
                      title={`Remove ${r.token}`}
                      aria-label={`Remove ${r.token}`}
                      className={iconBtnDanger}
                    >
                      {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
