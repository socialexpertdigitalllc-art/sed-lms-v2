"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ImagePlus, KeyRound, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, Pill } from "@/components/common/Panel";
import { btnPrimary, btnSecondarySm, btnGhostSm, iconBtn, iconBtnDanger } from "@/components/common/buttons";
import { Field, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import type { ImageHostStatus } from "@/lib/photo-capture/hosts/config";

/**
 * Operator UI for the image-host fallback chain.
 *
 * CREDENTIAL RULE: the API never returns a credential and this component never
 * asks for one back. Everything shown about a stored key comes from
 * `configured` and the server-side masked `hint` — a secret never enters a
 * `value` attribute or a piece of state that renders, other than the draft
 * "add a host" password field, which is discarded (never echoed) the moment
 * the POST resolves.
 *
 * `hosts` is read straight from props on every render rather than copied into
 * local state: the mutating actions below call `router.refresh()`, which
 * re-runs the server component and hands this component a fresh `hosts` array.
 * That keeps `move()`'s sibling/position math always working off the
 * authoritative order instead of a copy that could drift from it.
 */

const PROVIDERS = [
  { key: "imgbb", label: "imgbb", secretLabel: "API key", needsSecret: true },
  { key: "postimages", label: "postimages.org", secretLabel: null, needsSecret: false },
  { key: "imgchest", label: "imgchest.com", secretLabel: "Personal access token", needsSecret: true },
] as const;

type ProviderKey = (typeof PROVIDERS)[number]["key"];

function providerSpec(key: string) {
  return PROVIDERS.find((p) => p.key === key) ?? PROVIDERS[0];
}

function isCooling(host: ImageHostStatus): boolean {
  return !!host.exhaustedUntil && new Date(host.exhaustedUntil) > new Date();
}

export function ImageHostsPanel({ hosts }: { hosts: ImageHostStatus[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ provider: ProviderKey; label: string; secret: string }>({
    provider: "imgbb",
    label: "",
    secret: "",
  });

  async function call(url: string, init: RequestInit, busyKey: string): Promise<boolean> {
    setBusyId(busyKey);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Request failed", body: typeof data.error === "string" ? data.error : undefined });
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast({ kind: "error", title: "Request failed" });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function add() {
    const spec = providerSpec(draft.provider);
    if (spec.needsSecret && !draft.secret.trim()) {
      toast({ kind: "error", title: `${spec.label} needs ${spec.secretLabel ? `a ${spec.secretLabel}` : "a key"}` });
      return;
    }
    setAdding(true);
    const ok = await call(
      "/api/admin/image-hosts",
      {
        method: "POST",
        body: JSON.stringify({
          provider: draft.provider,
          label: draft.label,
          // postimages has no API keys at all — never send a secret for it,
          // even if the field somehow held stale text from a prior selection.
          secret: spec.needsSecret ? draft.secret : null,
        }),
      },
      "add",
    );
    setAdding(false);
    if (ok) {
      setDraft({ provider: draft.provider, label: "", secret: "" });
      toast({ kind: "success", title: `${spec.label} host added` });
    }
  }

  async function move(host: ImageHostStatus, delta: 1 | -1) {
    // SWAP with the neighbouring host of the same provider — do not just write
    // `position + delta`. An absolute write lets two rows share a position,
    // after which the list silently stops matching what the operator clicked.
    // (Upload order stays deterministic either way, because `orderHosts`
    // tie-breaks on id — it just stops being the order the operator chose.)
    const siblings = hosts.filter((h) => h.provider === host.provider).sort((a, b) => a.position - b.position);
    const neighbour = siblings[siblings.findIndex((h) => h.id === host.id) + delta];
    if (!neighbour) return;

    const moved = await call(
      `/api/admin/image-hosts/${host.id}`,
      { method: "PATCH", body: JSON.stringify({ position: neighbour.position }) },
      host.id,
    );
    if (!moved) return; // First write failed: nothing changed, safe to stop.
    await call(
      `/api/admin/image-hosts/${neighbour.id}`,
      { method: "PATCH", body: JSON.stringify({ position: host.position }) },
      neighbour.id,
    );
  }

  async function toggle(host: ImageHostStatus) {
    await call(
      `/api/admin/image-hosts/${host.id}`,
      { method: "PATCH", body: JSON.stringify({ enabled: !host.enabled, clearError: !host.enabled }) },
      host.id,
    );
  }

  async function clearError(host: ImageHostStatus) {
    await call(`/api/admin/image-hosts/${host.id}`, { method: "PATCH", body: JSON.stringify({ clearError: true }) }, host.id);
  }

  async function remove(host: ImageHostStatus) {
    if (!confirm(`Remove this ${providerSpec(host.provider).label} host? This cannot be undone.`)) return;
    await call(`/api/admin/image-hosts/${host.id}`, { method: "DELETE" }, host.id);
  }

  const draftSpec = providerSpec(draft.provider);
  const groups = PROVIDERS.map((spec) => ({
    spec,
    rows: hosts.filter((h) => h.provider === spec.key).sort((a, b) => a.position - b.position),
  }));

  return (
    <div className="space-y-4">
      <Panel
        icon={ImagePlus}
        title="Fallback chain"
        description="Uploads try imgbb first, then postimages.org, then imgchest.com — that order is fixed. Within a provider, keys are tried top to bottom. A key that reports a limit sits out for an hour; a key that reports a bad credential is disabled until fixed."
      >
        <div className="space-y-5">
          {groups.map(({ spec, rows }) => (
            <div key={spec.key}>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-display text-xs font-semibold uppercase tracking-wide text-text-faint">{spec.label}</span>
                {!spec.needsSecret ? <Pill tone="neutral">no key — on/off only</Pill> : null}
              </div>

              {rows.length === 0 ? (
                <p className="text-xs text-text-faint">No hosts configured for {spec.label}.</p>
              ) : (
                <ul className="space-y-2">
                  {rows.map((h, i) => (
                    <li
                      key={h.id}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle bg-surface-2 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-text">{h.label || spec.label}</span>
                          {h.enabled ? (
                            <Pill tone={h.configured ? "ready" : "notready"}>{h.configured ? "configured" : "no key"}</Pill>
                          ) : (
                            <Pill tone="neutral">disabled</Pill>
                          )}
                          {isCooling(h) ? <Pill tone="accent">cooling down</Pill> : null}
                        </div>
                        <p className="tabular mt-0.5 font-mono text-[11px] text-text-faint">
                          {h.hint ? `key ${h.hint} · ` : ""}
                          {h.uploadCount} upload{h.uploadCount === 1 ? "" : "s"}
                          {h.lastError ? ` · last error: ${h.lastError}` : ""}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          title="Move up"
                          aria-label="Move up"
                          disabled={busyId !== null || i === 0}
                          onClick={() => void move(h, -1)}
                          className={iconBtn}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Move down"
                          aria-label="Move down"
                          disabled={busyId !== null || i === rows.length - 1}
                          onClick={() => void move(h, 1)}
                          className={iconBtn}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        {h.lastError ? (
                          <button type="button" disabled={busyId !== null} onClick={() => void clearError(h)} className={btnGhostSm}>
                            Clear error
                          </button>
                        ) : null}
                        <button type="button" disabled={busyId !== null} onClick={() => void toggle(h)} className={btnSecondarySm}>
                          {h.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          title="Remove"
                          aria-label="Remove"
                          disabled={busyId !== null}
                          onClick={() => void remove(h)}
                          className={iconBtnDanger}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel icon={KeyRound} title="Add a host" description="New hosts start at the end of their provider's order.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Provider">
            <select
              value={draft.provider}
              onChange={(e) => setDraft({ provider: e.target.value as ProviderKey, label: "", secret: "" })}
              className={inputCls}
            >
              {PROVIDERS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label" hint="Optional — helps tell keys apart.">
            <input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="e.g. Main account"
              className={inputCls}
            />
          </Field>
          {draftSpec.needsSecret ? (
            <Field label={draftSpec.secretLabel ?? "Secret"} required>
              <input
                type="password"
                value={draft.secret}
                onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
                placeholder={draftSpec.secretLabel ?? ""}
                autoComplete="off"
                spellCheck={false}
                className={cn(inputCls, "font-mono")}
              />
            </Field>
          ) : (
            <div className="flex items-end pb-2">
              <span className="text-xs text-text-faint">postimages.org needs no key — this just adds the on/off row.</span>
            </div>
          )}
        </div>
        <button type="button" disabled={adding} onClick={() => void add()} className={cn(btnPrimary, "mt-3")}>
          <Plus className="h-4 w-4" /> Add host
        </button>
      </Panel>
    </div>
  );
}
