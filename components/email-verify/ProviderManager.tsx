"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Eye,
  Gauge,
  KeyRound,
  ListOrdered,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Wand2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, Pill } from "@/components/common/Panel";
import { btnPrimary, btnSecondary, btnSecondarySm, btnGhostSm, iconBtn } from "@/components/common/buttons";
import { Field, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { RECOMMENDED_ORDER, recommendedPriority } from "@/lib/email-verify/registry";
import type { ProviderSetting } from "@/lib/email-verify/adminView";

/**
 * Admin surface for the user-managed verification providers.
 *
 * CREDENTIAL RULE: the API never returns a credential and this component never
 * asks for one. Everything shown about what is stored comes from `configured`
 * and the server-side masked `hint`. Credential inputs start empty, live only
 * in local state while the form is open, and are discarded on save — nothing is
 * ever pre-filled, echoed back, or held after the request.
 */

type TestResult =
  | { ok: true; remaining: number | null; limit: number; period: string; checkedAt: string }
  | { ok: false | null; error: string };

const API = "/api/admin/email-providers";

/* ------------------------------------------------------------------ helpers */

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "in 13h", "in 6d" — how long the current free period has left to run. */
function untilReset(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const ms = t - Date.now();
  if (ms <= 0) return "any moment";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/** Healthy → low → exhausted, on the shared semantic ramp. */
function quotaTone(remaining: number | null, limit: number): "ready" | "notready" | "dropped" | "neutral" {
  if (remaining === null || limit <= 0) return "neutral";
  if (remaining <= 0) return "dropped";
  return remaining / limit < 0.25 ? "notready" : "ready";
}

const BAR_FILL: Record<string, string> = {
  ready: "bg-ready-fg",
  notready: "bg-notready-fg",
  dropped: "bg-dropped-fg",
  neutral: "bg-border",
};

/* ------------------------------------------------------------- quota block */

function QuotaMeter({ provider, onRefresh, refreshing }: { provider: ProviderSetting; onRefresh: () => void; refreshing: boolean }) {
  const q = provider.quota;
  const limit = q?.limit ?? provider.freeLimit;
  const remaining = q?.remaining ?? null;
  const tone = quotaTone(remaining, limit);
  const pct = remaining === null || limit <= 0 ? 0 : Math.min(100, Math.max(0, (remaining / limit) * 100));

  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
          <span className="text-xs font-medium text-text">Remaining quota</span>
        </div>
        <div className="flex items-center gap-1.5">
          {q ? (
            <Pill tone={q.source === "provider" ? "accent" : "neutral"} className="normal-case">
              {q.source === "provider" ? "live from provider" : "estimated from our counter"}
            </Pill>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="Re-check remaining quota"
            aria-label="Re-check remaining quota"
            className={iconBtn}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      <p className="tabular mt-2 font-mono text-lg leading-none text-text">
        {remaining === null ? "—" : remaining}
        <span className="text-sm text-text-faint"> / {limit}</span>
      </p>

      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border-subtle"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={remaining ?? undefined}
        aria-label={`${provider.label} remaining quota`}
      >
        <div className={cn("h-full rounded-full transition-colors duration-150", BAR_FILL[tone])} style={{ width: `${pct}%` }} />
      </div>

      <p className="tabular mt-2 font-mono text-[11px] text-text-faint">
        per {q?.period ?? provider.period} · resets {untilReset(q?.periodEnd)} · checked {fmtTime(q?.checkedAt)}
      </p>

      {q?.error ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-notready-fg">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{q.error}</span>
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- credential block */

function CredentialForm({
  provider,
  onSaved,
}: {
  provider: ProviderSetting;
  onSaved: (next: Partial<ProviderSetting>) => void;
}) {
  const { toast } = useToast();
  // Open by default only when nothing is stored — a configured provider shows
  // its masked hint until the operator explicitly asks to replace it.
  const [open, setOpen] = useState(!provider.configured);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const complete = provider.fields.every((f) => (values[f.key] ?? "").trim().length > 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!complete) return;
    setSaving(true);
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_key: provider.key, credentials: values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Could not save credentials", body: data.error });
        return;
      }
      // Drop the plaintext the moment the request resolves.
      setValues({});
      setOpen(false);
      onSaved({ configured: data.provider?.configured ?? true, hint: data.provider?.hint ?? null, updatedAt: data.provider?.updatedAt ?? null });
      toast({ kind: "success", title: `${provider.label} credentials saved` });
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm(`Clear the stored ${provider.label} credentials? It will be skipped in the fallback chain until new ones are entered.`)) return;
    setClearing(true);
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_key: provider.key, credentials: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Could not clear credentials", body: data.error });
        return;
      }
      setValues({});
      setOpen(true);
      onSaved({ configured: false, hint: null, updatedAt: data.provider?.updatedAt ?? null });
      toast({ kind: "success", title: `${provider.label} credentials cleared` });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
          <span className="text-xs font-medium text-text">Credentials</span>
          {provider.configured ? (
            <span className="tabular truncate font-mono text-[11px] text-text-muted" title="A masked echo — the stored secret is never sent to the browser">
              {provider.hint ?? "stored"}
            </span>
          ) : (
            <span className="text-[11px] text-text-faint">not set</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {provider.configured ? (
            <>
              <button type="button" onClick={() => setOpen((v) => !v)} className={btnGhostSm}>
                <Eye className="h-4 w-4" /> {open ? "Cancel" : "Replace credentials"}
              </button>
              <button type="button" onClick={clear} disabled={clearing} className={btnGhostSm}>
                {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Clear
              </button>
            </>
          ) : null}
        </div>
      </div>

      {open ? (
        <form onSubmit={save} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {provider.fields.map((f) => (
              <Field key={f.key} label={f.label} required>
                <input
                  type={f.type === "password" ? "password" : "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder ?? ""}
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(inputCls, f.type === "password" && "font-mono")}
                />
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Encrypted at rest. Never sent back to the browser — only a masked hint is.
            </p>
            <button type="submit" disabled={!complete || saving} className={btnPrimary}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {provider.configured ? "Replace" : "Save"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- one card */

function ProviderCard({
  provider,
  position,
  total,
  onMove,
  onPatch,
  busy,
}: {
  provider: ProviderSetting;
  position: number;
  total: number;
  onMove: (key: string, dir: -1 | 1) => void;
  onPatch: (key: string, next: Partial<ProviderSetting>) => void;
  busy: boolean;
}) {
  const { toast } = useToast();
  const [toggling, setToggling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const skipped = !provider.enabled
    ? "disabled"
    : !provider.configured
      ? "no credentials"
      : provider.quota && provider.quota.remaining !== null && provider.quota.remaining <= 0
        ? "out of quota"
        : null;

  async function toggle() {
    setToggling(true);
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_key: provider.key, enabled: !provider.enabled }),
      });
      if (!res.ok) {
        toast({ kind: "error", title: "Could not change the provider" });
        return;
      }
      onPatch(provider.key, { enabled: !provider.enabled });
    } finally {
      setToggling(false);
    }
  }

  async function refreshQuota() {
    setRefreshing(true);
    try {
      const res = await fetch(API, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Could not refresh the quota" });
        return;
      }
      const fresh = (data.providers as ProviderSetting[] | undefined)?.find((p) => p.key === provider.key);
      if (fresh) onPatch(provider.key, { quota: fresh.quota, configured: fresh.configured, hint: fresh.hint });
    } finally {
      setRefreshing(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch(`${API}/${encodeURIComponent(provider.key)}/test`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data?.ok === true) setTest({ ok: true, remaining: data.remaining ?? null, limit: data.limit ?? provider.freeLimit, period: data.period ?? provider.period, checkedAt: data.checkedAt });
      else setTest({ ok: data?.ok ?? false, error: data?.error ?? "The test could not be completed" });
    } catch {
      setTest({ ok: false, error: "The test request failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border bg-surface transition-colors duration-150",
        provider.enabled ? "border-border" : "border-border-subtle",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex shrink-0 flex-col items-center gap-1">
            <span
              className="tabular grid h-7 w-7 place-items-center rounded-md bg-accent-soft font-mono text-xs font-semibold text-accent-ink"
              title={`Tried ${position === 1 ? "first" : `#${position}`} in the fallback chain`}
            >
              {position}
            </span>
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => onMove(provider.key, -1)}
                disabled={position === 1 || busy}
                title={`Move ${provider.label} up`}
                aria-label={`Move ${provider.label} up in the fallback order`}
                className={cn(iconBtn, "h-6 w-7")}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onMove(provider.key, 1)}
                disabled={position === total || busy}
                title={`Move ${provider.label} down`}
                aria-label={`Move ${provider.label} down in the fallback order`}
                className={cn(iconBtn, "h-6 w-7")}
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 font-display text-sm font-semibold leading-tight text-text">
              <span className="truncate">{provider.label}</span>
              {skipped ? (
                <Pill tone={skipped === "out of quota" ? "dropped" : "neutral"} className="normal-case">
                  skipped — {skipped}
                </Pill>
              ) : (
                <Pill tone="ready" className="normal-case">
                  in the chain
                </Pill>
              )}
            </h3>
            <p className="tabular mt-0.5 font-mono text-[11px] text-text-faint">
              {provider.freeLimit} free / {provider.period}
              {provider.updatedAt ? ` · updated ${fmtTime(provider.updatedAt)}` : ""}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {provider.docsUrl ? (
            <a href={provider.docsUrl} target="_blank" rel="noreferrer" className={btnGhostSm} title={`${provider.label} API documentation`}>
              <ExternalLink className="h-4 w-4" /> Docs
            </a>
          ) : null}
          <button
            type="button"
            role="switch"
            aria-checked={provider.enabled}
            aria-label={`${provider.enabled ? "Disable" : "Enable"} ${provider.label}`}
            onClick={toggle}
            disabled={toggling}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-55",
              provider.enabled ? "bg-accent" : "bg-border",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-surface transition-transform duration-150",
                provider.enabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>
      </header>

      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <QuotaMeter provider={provider} onRefresh={refreshQuota} refreshing={refreshing} />

        <div className="rounded-md border border-border-subtle bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
            <span className="text-xs font-medium text-text">Connection test</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
            Checks the stored credentials against the vendor&rsquo;s free balance endpoint. It does not verify an address, so it costs no
            verification credit.
          </p>
          <button type="button" onClick={runTest} disabled={testing || !provider.configured} className={cn(btnSecondarySm, "mt-2")}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Test connection
          </button>

          {test ? (
            test.ok === true ? (
              <p className="tabular mt-2 flex items-start gap-1.5 font-mono text-[11px] leading-relaxed text-ready-fg">
                <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  Credentials accepted — {test.remaining ?? "?"} of {test.limit} credits left this {test.period}.
                </span>
              </p>
            ) : (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-dropped-fg">
                <XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{test.error}</span>
              </p>
            )
          ) : null}
        </div>

        <div className="lg:col-span-2">
          <CredentialForm provider={provider} onSaved={(next) => onPatch(provider.key, next)} />
        </div>

        {provider.privacyNote ? <p className="text-[11px] leading-relaxed text-text-faint lg:col-span-2">{provider.privacyNote}</p> : null}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------- shell */

export function ProviderManager({ providers }: { providers: ProviderSetting[] }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<ProviderSetting[]>(() => [...providers].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key)));
  const [saving, setSaving] = useState(false);

  const isRecommended = useMemo(
    () => rows.every((r, i) => r.key === RECOMMENDED_ORDER[i]) && rows.length === RECOMMENDED_ORDER.length,
    [rows],
  );

  const patch = useCallback((key: string, next: Partial<ProviderSetting>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }, []);

  /**
   * Persist an order. Priority IS the array index, so we PUT only the providers
   * whose index actually changed; the local list is updated first so the arrows
   * stay responsive, and rolled back if the server refuses.
   */
  const persistOrder = useCallback(
    async (next: ProviderSetting[], previous: ProviderSetting[]) => {
      const reindexed = next.map((r, i) => ({ ...r, priority: i }));
      const before = new Map(previous.map((r) => [r.key, r.priority]));
      const changed = reindexed.filter((r) => before.get(r.key) !== r.priority);
      setRows(reindexed);
      if (!changed.length) return;
      setSaving(true);
      try {
        const results = await Promise.all(
          changed.map((r) =>
            fetch(API, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider_key: r.key, priority: r.priority }),
            }),
          ),
        );
        if (results.some((res) => !res.ok)) {
          setRows(previous);
          toast({ kind: "error", title: "Could not save the new order" });
          return;
        }
        toast({ kind: "success", title: "Fallback order saved" });
      } catch {
        setRows(previous);
        toast({ kind: "error", title: "Could not save the new order" });
      } finally {
        setSaving(false);
      }
    },
    [toast],
  );

  function move(key: string, dir: -1 | 1) {
    const from = rows.findIndex((r) => r.key === key);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[from], next[to]] = [next[to], next[from]];
    void persistOrder(next, rows);
  }

  function useRecommended() {
    const next = [...rows].sort((a, b) => recommendedPriority(a.key) - recommendedPriority(b.key) || a.key.localeCompare(b.key));
    void persistOrder(next, rows);
  }

  return (
    <div className="space-y-4">
      <Panel
        icon={ListOrdered}
        title="Fallback order"
        description="Providers are tried top to bottom. Move the one you trust most to position 1."
        action={
          <button type="button" onClick={useRecommended} disabled={saving || isRecommended} className={btnSecondary} title="Apply the registry's recommended order">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Use recommended order
          </button>
        }
      >
        <p className="text-xs leading-relaxed text-text-muted">
          Recommended order:{" "}
          <span className="tabular font-mono text-text">
            {RECOMMENDED_ORDER.map((k, i) => `${i + 1}. ${rows.find((r) => r.key === k)?.label ?? k}`).join("  →  ")}
          </span>
          {isRecommended ? <span className="ml-2 text-ready-fg">You are on it.</span> : null}
        </p>
      </Panel>

      <div className="space-y-4">
        {rows.map((p, i) => (
          <ProviderCard key={p.key} provider={p} position={i + 1} total={rows.length} onMove={move} onPatch={patch} busy={saving} />
        ))}
      </div>

      <Panel icon={ShieldCheck} title="How the fallback works">
        <ol className="space-y-1.5 text-xs leading-relaxed text-text-muted">
          <li>
            <span className="text-text">1.</span> Every address first goes through the free local checks — syntax, DNS/MX, disposable and
            role-account lists. Most answers never need a provider at all.
          </li>
          <li>
            <span className="text-text">2.</span> When a deeper answer is asked for, providers are tried in the priority order above,
            starting at position 1.
          </li>
          <li>
            <span className="text-text">3.</span> A provider is skipped without being called when it is disabled, has no stored
            credentials, or has no quota left for the current period.
          </li>
          <li>
            <span className="text-text">4.</span> The first provider that answers wins, and its answer is cached so the same address is
            never paid for twice.
          </li>
          <li>
            <span className="text-text">5.</span> If none of them can answer, you still get a verdict from the local checks alone — and it
            is labelled as such, so nobody mistakes it for a mailbox confirmation.
          </li>
        </ol>
      </Panel>
    </div>
  );
}
