"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Ban,
  Check,
  CircleAlert,
  Clock,
  Info,
  Loader2,
  Pencil,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  UserCheck,
  X,
} from "lucide-react";
import { canUndo, isOpen, RISK_LABEL, STATUS_LABEL, type ActionCard as Card, type CardField, type EditSpec } from "@/lib/assistant/actions/card";
import { btnGhostSm, btnPrimary, btnSecondarySm } from "@/components/common/buttons";
import { cn } from "@/lib/utils";
import type { CardOp, CardOpBody, CardOpResult } from "./useAssistantChat";

/**
 * A change SED AI prepared, as the person sees it before (and after) it
 * happens: exactly what will change, how risky it is, and the one button that
 * makes it happen. Small values can be fixed right on the card; bulk changes
 * list every record with a tick box; risky ones ask for a tick ("I've
 * checked") or the words typed out. Once done: what happened, a link to it,
 * and Undo while that is still possible.
 */

type Problem = { field: string; message: string };

function EditInput({ spec, value, onChange, label }: { spec: EditSpec; value: string; onChange: (v: string) => void; label: string }) {
  const cls = "w-full rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-text focus:border-accent focus:outline-none";
  switch (spec.type) {
    case "longtext":
      return <textarea className={cn(cls, "min-h-[72px] resize-y")} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus />;
    case "enum":
      return (
        <select className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus>
          {!spec.options?.some((o) => o.value === value) ? <option value={value}>{value || "—"}</option> : null}
          {(spec.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "boolean":
      return (
        <select className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case "datetime":
      return <input type="datetime-local" className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus />;
    case "date":
      return <input type="date" className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus />;
    case "number":
      return <input type="number" inputMode="decimal" className={cls} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus />;
    default:
      return (
        <input
          type={spec.type === "email" ? "email" : spec.type === "url" ? "url" : spec.type === "phone" ? "tel" : "text"}
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          autoFocus
        />
      );
  }
}

function FieldRow({
  field,
  editable,
  edited,
  onEdit,
  problem,
}: {
  field: CardField;
  editable: boolean;
  edited: string | undefined;
  onEdit: (v: string | undefined) => void;
  problem?: string;
}) {
  const [editing, setEditing] = useState(false);
  const spec = field.edit ?? null;
  const shown = edited !== undefined ? displayEdit(spec, edited) : field.value;
  return (
    <div className="grid grid-cols-1 gap-x-3 py-1 @[340px]:grid-cols-[minmax(84px,34%)_1fr]">
      <dt className="pt-0.5 text-xs text-text-faint @[340px]:text-[length:inherit]">{field.label}</dt>
      <dd className="min-w-0">
        {editing && spec ? (
          <div className="space-y-1.5">
            <EditInput spec={spec} value={edited ?? spec.raw} onChange={(v) => onEdit(v)} label={field.label} />
            <div className="flex gap-1.5">
              <button type="button" className={btnSecondarySm} onClick={() => setEditing(false)}>
                Done
              </button>
              <button
                type="button"
                className={btnGhostSm}
                onClick={() => {
                  onEdit(undefined);
                  setEditing(false);
                }}
              >
                Reset
              </button>
            </div>
          </div>
        ) : (
          <div className="group/field flex items-start gap-1">
            <span className={cn("min-w-0 whitespace-pre-wrap break-words text-text", !shown && "text-text-faint", edited !== undefined && "font-medium text-accent-ink")}>
              {shown || "—"}
            </span>
            {editable && spec ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-0.5 shrink-0 rounded p-0.5 text-text-faint opacity-60 transition-opacity hover:bg-surface-2 hover:text-text group-hover/field:opacity-100"
                aria-label={`Change ${field.label}`}
                title={`Change ${field.label}`}
              >
                <Pencil className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
          </div>
        )}
        {problem ? <p className="mt-0.5 text-xs text-dropped-fg">{problem}</p> : null}
      </dd>
    </div>
  );
}

function displayEdit(spec: EditSpec | null, raw: string): string {
  if (!spec) return raw;
  if (spec.type === "boolean") return raw === "true" ? "Yes" : raw === "false" ? "No" : raw;
  if (spec.type === "enum") return spec.options?.find((o) => o.value === raw)?.label ?? raw;
  if (spec.type === "datetime" && raw) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : `${raw.replace("T", " ")} (company time)`;
  }
  return raw;
}

function minutesLeft(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 60_000));
}

function StatusIcon({ card }: { card: Card }) {
  const c = "h-4 w-4 shrink-0";
  switch (card.status) {
    case "executing":
      return <Loader2 className={cn(c, "animate-spin text-accent")} aria-hidden />;
    case "done":
      return <Check className={cn(c, "text-ready-fg")} aria-hidden />;
    case "failed":
      return <CircleAlert className={cn(c, "text-dropped-fg")} aria-hidden />;
    case "awaiting_approval":
      return <UserCheck className={cn(c, "text-longterm-fg")} aria-hidden />;
    case "cancelled":
    case "expired":
    case "rejected":
      return <Ban className={cn(c, "text-text-faint")} aria-hidden />;
    case "undone":
      return <Undo2 className={cn(c, "text-text-faint")} aria-hidden />;
    default:
      return card.risk === "critical" ? (
        <ShieldAlert className={cn(c, "text-dropped-fg")} aria-hidden />
      ) : card.risk === "sensitive" ? (
        <ShieldAlert className={cn(c, "text-notready-fg")} aria-hidden />
      ) : (
        <ShieldCheck className={cn(c, "text-accent")} aria-hidden />
      );
  }
}

export function ActionCardView({
  card,
  onOp,
  compact = false,
}: {
  card: Card;
  onOp: (card: Card, op: CardOp, body?: CardOpBody) => Promise<CardOpResult>;
  compact?: boolean;
}) {
  const open = isOpen(card);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set((card.items ?? []).filter((i) => i.selected).map((i) => i.id)));
  const [checked, setChecked] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<CardOp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // A finished card is a record: its details fold away (one tap to see them).
  const [details, setDetails] = useState(() => open || card.status === "awaiting_approval");

  // The undo countdown ticks while undo is possible.
  const undoable = canUndo(card, now);
  useEffect(() => {
    if (!undoable) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [undoable]);

  const items = card.items ?? [];
  const needsApproval = Boolean(card.approval) && open;
  const phraseOk = card.risk !== "critical" || (card.confirmPhrase ?? "").trim().toLowerCase() === phrase.trim().toLowerCase();
  const canConfirm = open && !needsApproval && (card.risk !== "sensitive" || checked) && phraseOk && (!items.length || selected.size > 0) && !busy;
  const problemFor = useMemo(() => new Map(problems.map((p) => [p.field, p.message])), [problems]);

  async function run(op: CardOp, body: CardOpBody = {}) {
    setBusy(op);
    setError(null);
    setProblems([]);
    const res = await onOp(card, op, body);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      setProblems(res.problems ?? []);
    } else {
      setEdits({});
      setNow(Date.now());
    }
  }

  const text = compact ? "text-[13px]" : "text-sm";
  const edited = Object.keys(edits).length;

  return (
    <section
      className={cn(
        "@container overflow-hidden rounded-xl border bg-surface shadow-[0_1px_4px_-2px_rgba(15,23,42,0.12)]",
        open ? (card.risk === "critical" ? "border-dropped-fg/40" : card.risk === "sensitive" ? "border-notready-fg/40" : "border-accent/40") : "border-border",
        text,
      )}
      aria-label={`${card.title} — ${STATUS_LABEL[card.status]}`}
    >
      {/* Header */}
      <header className="flex items-start gap-2 border-b border-border-subtle bg-surface-2/60 px-3.5 py-2.5">
        <span className="mt-0.5">
          <StatusIcon card={card} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug text-text">{card.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-text-faint">
            {card.plan ? (
              <span>
                Step {card.plan.index}
                {card.plan.total ? ` of ${card.plan.total}` : ""} · {card.plan.title}
              </span>
            ) : (
              <span>{card.group}</span>
            )}
            <span aria-hidden>·</span>
            <span className={cn(card.status === "done" && "text-ready-fg", card.status === "failed" && "text-dropped-fg")}>{STATUS_LABEL[card.status]}</span>
            {open && card.risk !== "standard" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px font-medium",
                  card.risk === "critical" ? "bg-dropped-bg text-dropped-fg" : "bg-notready-bg text-notready-fg",
                )}
              >
                {RISK_LABEL[card.risk]}
              </span>
            ) : null}
          </p>
        </div>
      </header>

      <div className="space-y-3 px-3.5 py-3">
        {!details && (card.fields.length || card.changes?.length || card.items?.length) ? (
          <button type="button" onClick={() => setDetails(true)} className="text-xs font-medium text-text-muted hover:text-text">
            Show details
          </button>
        ) : null}
        {/* What will change */}
        {details && card.fields.length ? (
          <dl className="divide-y divide-border-subtle">
            {card.fields.map((f) => (
              <FieldRow
                key={f.name}
                field={f}
                editable={open && !needsApproval && card.risk !== "critical"}
                edited={edits[f.name]}
                problem={problemFor.get(f.name)}
                onEdit={(v) =>
                  setEdits((prev) => {
                    const next = { ...prev };
                    if (v === undefined) delete next[f.name];
                    else next[f.name] = v;
                    return next;
                  })
                }
              />
            ))}
          </dl>
        ) : null}

        {details && card.changes?.length ? (
          <ul className="space-y-1">
            {card.changes.map((c) => (
              <li key={c.label} className="grid grid-cols-1 gap-x-3 @[340px]:grid-cols-[minmax(84px,34%)_1fr]">
                <span className="text-xs text-text-faint @[340px]:text-[length:inherit]">{c.label}</span>
                <span className="min-w-0 break-words">
                  <span className="text-text-faint line-through decoration-text-faint/60">{c.from}</span>
                  <ArrowRight className="mx-1 inline h-3 w-3 text-text-faint" aria-hidden />
                  <span className="font-medium text-text">{c.to}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {details && items.length ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-text-faint">
              <span>
                {open ? `${selected.size} of ${items.length} selected` : `${items.length} record${items.length === 1 ? "" : "s"}`}
              </span>
              {open ? (
                <span className="flex gap-2">
                  <button type="button" className="hover:text-text" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
                    All
                  </button>
                  <button type="button" className="hover:text-text" onClick={() => setSelected(new Set())}>
                    None
                  </button>
                </span>
              ) : null}
            </div>
            <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border-subtle p-1">
              {items.map((i) => (
                <li key={i.id}>
                  <label className={cn("flex items-start gap-2 rounded-md px-2 py-1", open && "cursor-pointer hover:bg-surface-2")}>
                    {open ? (
                      <input
                        type="checkbox"
                        className="mt-1 accent-[var(--color-accent)]"
                        checked={selected.has(i.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(i.id);
                            else next.delete(i.id);
                            return next;
                          })
                        }
                      />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      {i.href ? (
                        <Link href={i.href} className="text-text hover:underline">
                          {i.label}
                        </Link>
                      ) : (
                        <span className="text-text">{i.label}</span>
                      )}
                      {i.detail ? <span className="text-text-faint"> — {i.detail}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {card.warnings?.length && (open || card.status === "awaiting_approval") ? (
          <ul className="space-y-1 rounded-lg bg-notready-bg/60 px-3 py-2 text-notready-fg">
            {card.warnings.map((w) => (
              <li key={w} className="flex gap-1.5">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {card.notes?.length && open ? (
          <ul className="space-y-0.5 text-xs text-text-muted">
            {card.notes.map((n) => (
              <li key={n} className="flex gap-1.5">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-text-faint" aria-hidden />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Outcome */}
        {card.status === "done" || card.status === "undone" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-ready-bg/50 px-3 py-2 text-ready-fg">
            <span className="min-w-0 flex-1">{card.result?.message ?? "Done."}</span>
            {card.result?.link ? (
              <Link href={card.result.link.href} className="inline-flex items-center gap-1 font-medium hover:underline">
                {card.result.link.label} <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
          </div>
        ) : null}
        {card.status === "failed" || (card.error && card.status !== "cancelled") ? (
          <p className="flex gap-1.5 rounded-lg bg-dropped-bg/50 px-3 py-2 text-dropped-fg">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{card.error ?? "It could not be done."}</span>
          </p>
        ) : null}
        {card.status === "cancelled" ? <p className="text-xs text-text-faint">{card.error ?? "Cancelled — nothing was changed."}</p> : null}
        {card.status === "expired" ? <p className="text-xs text-text-faint">This expired before it was confirmed. Ask again for a fresh one.</p> : null}
        {card.status === "rejected" ? (
          <p className="text-xs text-text-muted">Not approved{card.approval?.note ? `: “${card.approval.note}”` : "."}</p>
        ) : null}
        {!card.result?.link && card.link && (open || card.status === "awaiting_approval") ? (
          <Link href={card.link.href} className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline">
            {card.link.label} <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}

        {/* Approval */}
        {needsApproval ? (
          <div className="space-y-2 rounded-lg border border-longterm-bg bg-longterm-bg/40 px-3 py-2.5">
            <p className="flex gap-1.5 text-longterm-fg">
              <UserCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{card.approval!.reason} An admin can approve it — it then runs as them.</span>
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder="Add a note for the admin (optional)"
              className="min-h-[52px] w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-text focus:border-accent focus:outline-none"
              aria-label="Note for the approver"
            />
          </div>
        ) : null}
        {card.status === "awaiting_approval" ? (
          <p className="flex gap-1.5 text-xs text-longterm-fg">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Sent to the admins{card.approval?.note ? ` with your note “${card.approval.note}”` : ""}. You&apos;ll get a notification when they decide.
          </p>
        ) : null}

        {/* Confirmation */}
        {open && !needsApproval && card.risk === "sensitive" ? (
          <label className="flex cursor-pointer items-start gap-2 text-text-muted">
            <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>I&apos;ve checked the details above.</span>
          </label>
        ) : null}
        {open && !needsApproval && card.risk === "critical" && card.confirmPhrase ? (
          <label className="block space-y-1">
            <span className="text-text-muted">
              To confirm, type <span className="rounded bg-surface-2 px-1 font-mono text-[12px] text-text">{card.confirmPhrase}</span>
            </span>
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-text focus:border-accent focus:outline-none"
              aria-label="Confirmation words"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ) : null}

        {error ? (
          <p className="flex gap-1.5 text-xs text-dropped-fg" role="alert">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}

        {open || card.status === "awaiting_approval" || undoable ? (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
            {undoable ? (
              <button type="button" className={btnSecondarySm} onClick={() => void run("undo")} disabled={busy !== null}>
                {busy === "undo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                Undo · {minutesLeft(card.undoUntil, now)} min left
              </button>
            ) : null}
            {open || card.status === "awaiting_approval" ? (
              <button type="button" className={btnGhostSm} onClick={() => void run("cancel")} disabled={busy !== null}>
                {busy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
                {card.status === "awaiting_approval" ? "Withdraw" : "Cancel"}
              </button>
            ) : null}
            {needsApproval ? (
              <button type="button" className={cn(btnPrimary, "px-3 py-1.5 text-[13px]")} onClick={() => void run("request", { note: note.trim() || undefined })} disabled={busy !== null}>
                {busy === "request" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UserCheck className="h-3.5 w-3.5" aria-hidden />}
                Ask an admin
              </button>
            ) : open ? (
              <button
                type="button"
                className={cn(btnPrimary, "px-3 py-1.5 text-[13px]", card.risk === "critical" && "bg-danger hover:bg-danger/90")}
                onClick={() =>
                  void run("confirm", {
                    ...(edited ? { edits } : {}),
                    ...(items.length ? { selected: [...selected] } : {}),
                    ...(card.risk === "critical" ? { phrase } : {}),
                  })
                }
                disabled={!canConfirm}
              >
                {busy === "confirm" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                {card.confirmLabel}
                {items.length ? ` (${selected.size})` : ""}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A plan's steps, with Run all while more than one is waiting. */
export function PlanBar({ cards, onRunAll, compact }: { cards: Card[]; onRunAll: () => Promise<{ ok: boolean; error?: string }>; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const waiting = cards.filter((c) => isOpen(c) && !c.approval && c.risk !== "critical");
  const open = waiting.length;
  // Running several steps at once is one confirmation for all of them: a step
  // that alone would ask "I've checked" asks it here too.
  const needsCheck = waiting.some((c) => c.risk === "sensitive");
  const done = cards.filter((c) => c.status === "done").length;
  const title = cards[0]?.plan?.title ?? "Plan";
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft/50 px-3.5 py-2", compact ? "text-[13px]" : "text-sm")}>
      <span className="min-w-0 flex-1 font-medium text-accent-ink">
        {title} · {done} of {cards.length} done
      </span>
      {error ? <span className="w-full text-xs text-dropped-fg">{error}</span> : null}
      {open > 1 && needsCheck ? (
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          I&apos;ve checked every step
        </label>
      ) : null}
      {open > 1 ? (
        <button
          type="button"
          className={cn(btnPrimary, "px-3 py-1.5 text-[13px]")}
          disabled={busy || (needsCheck && !checked)}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await onRunAll();
            setBusy(false);
            if (!r.ok) setError(r.error ?? "A step failed — see below.");
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          Run all {open} steps
        </button>
      ) : null}
    </div>
  );
}
