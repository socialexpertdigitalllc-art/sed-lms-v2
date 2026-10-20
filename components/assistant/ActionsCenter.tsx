"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Clock, ListChecks, Loader2, MessageSquare, ShieldAlert, X } from "lucide-react";
import type { PermissionMode } from "@/lib/assistant/actions/permissions";
import type { ActionCard } from "@/lib/assistant/actions/card";
import { btnGhostSm, btnPrimary, btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { ActionCardView } from "./ActionCard";
import { Automations } from "./Automations";
import { PhoneLink } from "./PhoneLink";
import { JSON_HEADERS, type CardOp, type CardOpBody, type CardOpResult } from "./useAssistantChat";
import { useActPermissions } from "./useActPermissions";
import { MODE_ICON } from "./PermissionModePicker";

type Row = ActionCard & {
  conversationId: string | null;
  source: string;
  requester: { id: string; name: string };
  approver: { id: string; name: string } | null;
  executedAt: string | null;
};

interface Report {
  from: string;
  to: string;
  totals: Record<string, number>;
  minutesSaved: number;
  byAction: { key: string; title: string; total: number; done: number; failed: number; minutesSaved: number }[];
  byPerson: { id: string; name: string; total: number; done: number; minutesSaved: number }[];
  bySource: Record<string, number>;
  recentFailures: { id: string; title: string; error: string | null; who: string; at: string }[];
  waitingApproval: number;
}

interface SettingRow {
  key: string;
  title: string;
  group: string;
  risk: string;
  enabled: boolean;
  require_approval: boolean;
  auto_run: boolean;
}

interface Policy {
  max_mode: PermissionMode;
  modes: { mode: PermissionMode; label: string; description: string }[];
}

const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const hours = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${m} min`);

async function cardOp(card: ActionCard, op: CardOp, body: CardOpBody = {}): Promise<CardOpResult> {
  try {
    const res = await fetch(`/api/assistant/actions/${card.id}/${op}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { card?: ActionCard; error?: string; problems?: { field: string; message: string }[] };
    if (!res.ok || !json.card) return { ok: false, error: json.error ?? `HTTP ${res.status}`, problems: json.problems };
    return { ok: true, card: json.card };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

function useList(scope: "mine" | "approvals" | "all", enabled: boolean) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const load = useCallback(
    async (before?: string) => {
      try {
        const res = await fetch(`/api/assistant/actions?scope=${scope}&limit=40${before ? `&before=${encodeURIComponent(before)}` : ""}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { actions?: Row[]; nextBefore?: string | null; error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setError(null);
        setRows((prev) => (before ? [...(prev ?? []), ...(body.actions ?? [])] : (body.actions ?? [])));
        setNext(body.nextBefore ?? null);
      } catch (e) {
        setError((e as Error).message);
        setRows((prev) => prev ?? []);
      }
    },
    [scope],
  );
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/assistant/actions?scope=${scope}&limit=40`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { actions?: Row[]; nextBefore?: string | null; error?: string };
        if (!alive) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setRows(body.actions ?? []);
        setNext(body.nextBefore ?? null);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        setRows([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, scope]);
  const replace = (card: ActionCard) => setRows((prev) => (prev ? prev.map((r) => (r.id === card.id ? { ...r, ...card } : r)) : prev));
  return { rows, error, next, load, replace };
}

function Mine() {
  const list = useList("mine", true);
  if (!list.rows) return <Loading />;
  if (list.error) return <Empty text={list.error} />;
  if (!list.rows.length) return <Empty text="Nothing yet. Switch the message box to Act and ask SED AI to do something for you." />;
  return (
    <div className="space-y-3">
      {list.rows.map((r) => (
        <div key={r.id} className="space-y-1">
          <p className="flex items-center gap-2 text-[11px] text-text-faint">
            <Clock className="h-3 w-3" aria-hidden /> {when(r.createdAt)}
            {r.source !== "chat" ? <span className="rounded bg-surface-2 px-1">{r.source}</span> : null}
            {r.conversationId ? (
              <Link href={`/assistant?c=${r.conversationId}`} className="inline-flex items-center gap-1 hover:text-text">
                <MessageSquare className="h-3 w-3" aria-hidden /> Open the chat
              </Link>
            ) : null}
          </p>
          <ActionCardView
            card={r}
            onOp={async (card, op, body) => {
              const res = await cardOp(card, op, body);
              if (res.ok) list.replace(res.card);
              return res;
            }}
          />
        </div>
      ))}
      {list.next ? (
        <button type="button" className={btnSecondarySm} onClick={() => void list.load(list.next!)}>
          Show older
        </button>
      ) : null}
    </div>
  );
}

function Approvals({ userId }: { userId: string }) {
  const { toast } = useToast();
  const list = useList("approvals", true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [phrases, setPhrases] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(r: Row, approve: boolean) {
    setBusy(r.id + approve);
    try {
      const res = await fetch(`/api/assistant/actions/${r.id}/decide`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ approve, note: notes[r.id] || undefined, ...(approve && r.risk === "critical" ? { phrase: phrases[r.id] ?? "" } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { card?: ActionCard; error?: string };
      if (!res.ok || !body.card) throw new Error(body.error ?? `HTTP ${res.status}`);
      list.replace(body.card);
      toast({
        kind: body.card.status === "done" ? "success" : body.card.status === "failed" ? "error" : "info",
        title: approve ? (body.card.status === "done" ? "Approved and done" : "Approved, but it failed") : "Turned down",
        body: body.card.error ?? body.card.result?.message ?? undefined,
      });
    } catch (e) {
      toast({ kind: "error", title: "Could not decide", body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }
  if (!list.rows) return <Loading />;
  if (list.error) return <Empty text={list.error} />;
  if (!list.rows.length) return <Empty text="No requests are waiting for approval." />;
  return (
    <div className="space-y-4">
      {list.rows.map((r) => {
        const own = r.requester.id === userId;
        // A high-impact change: the approver types its name too.
        const phraseOk = r.risk !== "critical" || (r.confirmPhrase ?? "").trim().toLowerCase() === (phrases[r.id] ?? "").trim().toLowerCase();
        return (
          <div key={r.id} className="space-y-2">
            <p className="text-xs text-text-muted">
              <span className="font-medium text-text">{own ? "You" : r.requester.name}</span> asked {when(r.createdAt)}
              {r.approval?.note ? ` — “${r.approval.note}”` : ""}
            </p>
            <ActionCardView card={r} onOp={async () => ({ ok: false, error: "Use Approve or Reject below." })} />
            {r.status === "awaiting_approval" && own ? (
              <p className="text-xs text-text-faint">This is your own request — another admin has to approve it. You can withdraw it from My actions.</p>
            ) : r.status === "awaiting_approval" ? (
              <div className="flex flex-wrap items-center gap-2">
                {r.risk === "critical" && r.confirmPhrase ? (
                  <label className="w-full space-y-1 text-sm">
                    <span className="text-text-muted">
                      High impact. To approve, type <span className="rounded bg-surface-2 px-1 font-mono text-[12px] text-text">{r.confirmPhrase}</span>
                    </span>
                    <input
                      value={phrases[r.id] ?? ""}
                      onChange={(e) => setPhrases((p) => ({ ...p, [r.id]: e.target.value }))}
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
                      aria-label="Confirmation words"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                ) : null}
                <input
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value.slice(0, 500) }))}
                  placeholder="Note to the requester (optional)"
                  className="min-w-[200px] flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
                  aria-label="Note to the requester"
                />
                <button type="button" className={btnGhostSm} disabled={busy !== null} onClick={() => void decide(r, false)}>
                  {busy === r.id + "false" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />} Reject
                </button>
                <button type="button" className={btnPrimary} disabled={busy !== null || !phraseOk} onClick={() => void decide(r, true)}>
                  {busy === r.id + "true" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Approve &amp; run as me
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ReportView() {
  const [days, setDays] = useState(30);
  // The answer for the period it was asked for: a stale one reads as loading.
  const [loaded, setLoaded] = useState<{ days: number; report: Report | null; error: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/assistant/actions/report?days=${days}`, { cache: "no-store" });
        const b = (await r.json().catch(() => ({}))) as { report?: Report; error?: string };
        if (!r.ok || !b.report) throw new Error(b.error ?? `HTTP ${r.status}`);
        if (alive) setLoaded({ days, report: b.report, error: null });
      } catch (e) {
        if (alive) setLoaded({ days, report: null, error: (e as Error).message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [days]);
  const current = loaded?.days === days ? loaded : null;
  const report = current?.report ?? null;
  const error = current?.error ?? null;
  return (
    <div className="space-y-5">
      <div className="flex gap-1">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className={cn(btnSecondarySm, days === d && "border-accent bg-accent-soft text-accent-ink")}>
            Last {d} days
          </button>
        ))}
      </div>
      {error ? <Empty text={error} /> : !report ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Actions" value={String(report.totals.all ?? 0)} />
            <Stat label="Done" value={String(report.totals.done ?? 0)} />
            <Stat label="Failed" value={String(report.totals.failed ?? 0)} />
            <Stat label="Time saved (approx.)" value={hours(report.minutesSaved)} />
          </div>
          {report.waitingApproval ? <p className="text-sm text-longterm-fg">{report.waitingApproval} request(s) are waiting for approval.</p> : null}
          <Table
            title="By action"
            head={["Action", "Asked", "Done", "Failed", "Saved"]}
            rows={report.byAction.map((a) => [a.title, a.total, a.done, a.failed, hours(a.minutesSaved)])}
          />
          <Table title="By person" head={["Person", "Asked", "Done", "Saved"]} rows={report.byPerson.map((p) => [p.name, p.total, p.done, hours(p.minutesSaved)])} />
          {report.recentFailures.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-text">Recent failures</h3>
              <ul className="space-y-1.5 text-sm">
                {report.recentFailures.map((f) => (
                  <li key={f.id} className="rounded-lg border border-border px-3 py-2">
                    <span className="font-medium text-text">{f.title}</span> <span className="text-text-faint">— {f.who}, {when(f.at)}</span>
                    {f.error ? <p className="mt-0.5 text-xs text-dropped-fg">{f.error}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** How much SED AI does without a click — each person's own choice. */
function PermissionsView() {
  const { toast } = useToast();
  const p = useActPermissions(true);
  if (!p.view) return p.error ? <Empty text={p.error} /> : <Loading />;
  const v = p.view;
  const save = async (patch: Parameters<typeof p.change>[0]) => {
    const err = await p.change(patch);
    if (err) toast({ kind: "error", title: "Could not save", body: err });
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-text">Permission mode</h3>
        <p className="mt-0.5 text-sm text-text-muted">How much SED AI does in Act mode without asking. You can also switch it from the message box.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Permission mode">
          {v.modes.map((m) => {
            const Icon = MODE_ICON[m.mode];
            const selected = v.effective === m.mode;
            return (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!m.allowed || p.saving}
                onClick={() => !selected && void save({ mode: m.mode })}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors",
                  selected ? "border-accent bg-accent-soft/60" : "border-border bg-surface hover:bg-surface-2",
                  !m.allowed && "cursor-not-allowed opacity-50 hover:bg-surface",
                )}
              >
                <span className="flex w-full items-center gap-1.5 text-sm font-medium text-text">
                  <Icon className={cn("h-4 w-4", m.mode === "ask" ? "text-text-muted" : m.mode === "auto_safe" ? "text-accent" : "text-notready-fg")} aria-hidden />
                  <span className="flex-1">{m.label}</span>
                  {selected ? <Check className="h-4 w-4 text-accent" aria-hidden /> : null}
                </span>
                <span className="text-xs leading-snug text-text-muted">{m.allowed ? m.description : "Your admin has limited SED AI below this."}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 flex gap-1.5 text-xs text-text-muted">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
          <span>
            Whatever you pick, high-impact changes (money, deleting, access, going live) and anything that needs an admin&apos;s approval always wait for you. Changes that ran
            on their own show “Ran on its own” on their card, with Undo while it lasts.
          </span>
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text">Don&apos;t ask again</h3>
            <p className="mt-0.5 text-sm text-text-muted">Actions you ticked “Don&apos;t ask again” for. They run on their own even in Ask mode.</p>
          </div>
          {v.allow.length > 1 ? (
            <button type="button" className={btnGhostSm} onClick={() => void save({ allow_clear: true })} disabled={p.saving}>
              Remove all
            </button>
          ) : null}
        </div>
        {v.allow.length ? (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {v.allow.map((a) => (
              <li key={a.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="text-text">{a.title}</span>
                  {a.group ? <span className="ml-2 text-xs text-text-faint">{a.group}</span> : null}
                </span>
                <button type="button" className={btnGhostSm} onClick={() => void save({ allow_remove: a.key })} disabled={p.saving}>
                  <X className="h-3.5 w-3.5" aria-hidden /> Ask again
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-text-faint">
            None yet. Tick “Don&apos;t ask again” on a card when you confirm it.
          </p>
        )}
      </div>
    </div>
  );
}

function SettingsView() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [access, setAccess] = useState<{ departments: { id: string; name: string }[]; people: { id: string; name: string; granted: boolean; until: string | null }[] } | null>(null);
  useEffect(() => {
    fetch("/api/assistant/actions/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { actions?: SettingRow[]; access?: typeof access; policy?: Policy }) => {
        setRows(b.actions ?? []);
        setAccess(b.access ?? null);
        setPolicy(b.policy ?? null);
      })
      .catch(() => setRows([]));
  }, []);
  async function saveLimit(max_mode: PermissionMode) {
    const before = policy;
    setPolicy((p) => (p ? { ...p, max_mode } : p));
    const res = await fetch("/api/assistant/actions/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ max_mode }) }).catch(() => null);
    if (!res?.ok) {
      setPolicy(before);
      toast({ kind: "error", title: "Could not save", body: ((await res?.json().catch(() => ({}))) as { error?: string } | undefined)?.error });
    }
  }
  async function save(key: string, patch: Partial<Pick<SettingRow, "enabled" | "require_approval" | "auto_run">>) {
    const before = rows;
    setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? prev);
    const res = await fetch("/api/assistant/actions/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ key, ...patch }) }).catch(() => null);
    if (!res?.ok) {
      setRows(before);
      toast({ kind: "error", title: "Could not save", body: ((await res?.json().catch(() => ({}))) as { error?: string } | undefined)?.error });
    }
  }
  if (!rows) return <Loading />;
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
        <p className="font-medium text-text">Who can use Act mode</p>
        <p className="mt-1">
          {access?.departments.length ? `Departments: ${access.departments.map((d) => d.name).join(", ")}.` : "No department has it yet."}{" "}
          {access?.people.filter((p) => p.granted).length
            ? `Also: ${access.people
                .filter((p) => p.granted)
                .map((p) => `${p.name}${p.until ? ` (until ${new Date(p.until).toLocaleDateString()})` : ""}`)
                .join(", ")}.`
            : ""}
        </p>
        <p className="mt-1 text-xs">
          Give it to more departments or people — or as a trial until a date — with the “Use SED AI Action Mode” permission on{" "}
          <Link href="/admin/permissions" className="font-medium text-accent-ink hover:underline">
            Permissions
          </Link>
          . Each action also needs the person&apos;s own permission for that change.
        </p>
      </div>
      {policy ? (
        <div className="rounded-xl border border-border px-4 py-3">
          <p className="text-sm font-medium text-text">Most SED AI may do on its own</p>
          <p className="mt-0.5 text-sm text-text-muted">
            Everyone picks their own permission mode (Ask first, or let changes run on their own). This caps it for the whole company. High-impact changes and
            approvals always ask.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Most SED AI may do on its own">
            {policy.modes.map((m) => (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={policy.max_mode === m.mode}
                title={m.description}
                onClick={() => policy.max_mode !== m.mode && void saveLimit(m.mode)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  policy.max_mode === m.mode ? "border-accent bg-accent-soft font-medium text-accent-ink" : "border-border text-text-muted hover:bg-surface-2",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g}>
          <h3 className="mb-2 text-sm font-semibold text-text">{g}</h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {rows
              .filter((r) => r.group === g)
              .map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className={cn("text-text", !r.enabled && "text-text-faint line-through")}>{r.title}</span>
                    <span className="ml-2 font-mono text-[11px] text-text-faint">{r.key}</span>
                  </span>
                  <span className={cn("rounded-full px-1.5 py-px text-[11px]", r.risk === "critical" ? "bg-dropped-bg text-dropped-fg" : r.risk === "sensitive" ? "bg-notready-bg text-notready-fg" : "bg-surface-2 text-text-muted")}>
                    {r.risk}
                  </span>
                  {r.risk !== "critical" ? (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted" title="Off: this always waits for a click, whatever a person's permission mode.">
                      <input type="checkbox" className="accent-[var(--color-accent)]" checked={r.auto_run} onChange={(e) => void save(r.key, { auto_run: e.target.checked })} disabled={!r.enabled || r.require_approval} />
                      Can run on its own
                    </label>
                  ) : null}
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                    <input type="checkbox" className="accent-[var(--color-accent)]" checked={r.require_approval} onChange={(e) => void save(r.key, { require_approval: e.target.checked })} disabled={!r.enabled} />
                    Always ask an admin
                  </label>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                    <input type="checkbox" className="accent-[var(--color-accent)]" checked={r.enabled} onChange={(e) => void save(r.key, { enabled: e.target.checked })} />
                    On
                  </label>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-text-faint">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold text-text">{value}</p>
    </div>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-text">{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-text-muted">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={cn("px-3 py-1.5", j === 0 ? "text-text" : "tabular-nums text-text-muted")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Loading = () => (
  <p className="flex items-center gap-2 py-10 text-sm text-text-faint">
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
  </p>
);
const Empty = ({ text }: { text: string }) => <p className="py-10 text-center text-sm text-text-faint">{text}</p>;

export function ActionsCenter({ userId, canAct, canManage, initialTab }: { userId: string; canAct: boolean; canManage: boolean; initialTab: string }) {
  const tabs = [
    ...(canAct ? [{ key: "mine", label: "My actions" }, { key: "permissions", label: "Permissions" }, { key: "automations", label: "Reminders & automations" }] : []),
    ...(canManage ? [{ key: "approvals", label: "Approvals" }, { key: "report", label: "Report" }, { key: "settings", label: "Settings" }] : []),
  ];
  const [tab, setTab] = useState(tabs.some((t) => t.key === initialTab) ? initialTab : (tabs[0]?.key ?? "mine"));
  useEffect(() => {
    window.history.replaceState(window.history.state, "", `/assistant/actions?tab=${tab}`);
  }, [tab]);
  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-10">
      <div className="flex items-center gap-3">
        <Link href="/assistant" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" aria-hidden /> SED AI
        </Link>
      </div>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent-ink">
          <ListChecks className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="font-display text-xl font-semibold text-text">SED AI actions</h1>
          <p className="text-sm text-text-muted">What SED AI prepared and did for you — each change confirmed by someone, or run on its own where their permission mode allows.</p>
        </div>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm transition-colors", tab === t.key ? "border-accent font-medium text-text" : "border-transparent text-text-muted hover:text-text")}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "mine" ? <Mine /> : tab === "permissions" ? <PermissionsView /> : tab === "automations" ? <Automations phone={<PhoneLink />} /> : tab === "approvals" ? <Approvals userId={userId} /> : tab === "report" ? <ReportView /> : <SettingsView />}
    </div>
  );
}
