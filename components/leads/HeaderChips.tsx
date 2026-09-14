"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, MapPin, Plus, Shapes, X, type LucideIcon } from "lucide-react";
import { US_STATES } from "@/lib/geo/areaCodes";

/** Portalled fixed-position coordinates for the chip popover — same pattern
 *  as DateTimeField's calendar: rendered into <body>, so the lead header's
 *  overflow-hidden band (or any other clipping ancestor) can never cut it
 *  off. Flips above the anchor near the bottom of the viewport. */
const POP_W = 240;
const POP_H = 320; // worst-case estimate: search + full list + create row
function popoverPosition(anchor: HTMLElement): { top: number; left: number } {
  const r = anchor.getBoundingClientRect();
  const below = r.bottom + 4;
  const fitsBelow = below + POP_H <= window.innerHeight;
  const top = fitsBelow || r.top - POP_H - 4 < 0 ? below : r.top - POP_H - 4;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
  return { top, left };
}

/**
 * The dedicated header chips: Area and Category.
 *
 * These are deliberately NOT ordinary form fields. They render as compact
 * pills in a section header — "+ Area" / "+ Category" when empty, a filled
 * accent pill when set — with a popover to pick (and, for categories, to
 * grow the shared catalog). Used in the new-lead form's Client Identity
 * header and in the lead screen's title band.
 */

export function ChipSelect({
  icon: Icon,
  label,
  value,
  derived,
  options,
  onSelect,
  onCreate,
  createHint,
  readOnly = false,
}: {
  icon: LucideIcon;
  label: string;
  /** The chosen value; null = nothing chosen. */
  value: string | null;
  /** Shown (muted, non-clearable) when no value is chosen — e.g. the area
   *  derived from the phone number on the lead screen. */
  derived?: string | null;
  options: string[];
  /** null clears the value (falls back to `derived` where one exists). */
  onSelect: (v: string | null) => void | Promise<void>;
  /** When set, an unmatched query offers `+ Add "query"`; must resolve to the
   *  created name (or null on failure, keeping the popover open). */
  onCreate?: (name: string) => Promise<string | null>;
  createHint?: string;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Close clears the position too, so a re-open never flashes at a stale
  // spot (state cleared in handlers, never synchronously in an effect —
  // repo rule react-hooks/set-state-in-effect; same shape as DateTimeField).
  const close = () => {
    setOpen(false);
    setPos(null);
  };

  // The popover is PORTALLED to <body>, so the outside-click check must look
  // in both trees — the anchor's and the popover's.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
      setPos(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setPos(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Position while open; tracks resize and any ancestor scroll (the
  // DateTimeField pattern).
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (ref.current) setPos(popoverPosition(ref.current));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.toLowerCase().includes(needle));
  }, [options, q]);

  const exactMatch = useMemo(
    () => options.some((o) => o.toLowerCase() === q.trim().toLowerCase()),
    [options, q],
  );

  async function pick(v: string | null) {
    setBusy(true);
    setErr(null);
    try {
      await onSelect(v);
      close();
      setQ("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = q.trim();
    if (!name || !onCreate || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await onCreate(name);
      if (created) {
        await onSelect(created);
        close();
        setQ("");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(false);
    }
  }

  const shown = value ?? derived ?? null;
  if (readOnly && !shown) return null;

  const pillBase =
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors";

  return (
    <div ref={ref} className="relative">
      {shown ? (
        <span
          className={
            pillBase +
            " border " +
            (value
              ? "border-accent/40 bg-accent-soft text-accent-ink"
              : "border-border bg-surface-2 text-text-muted")
          }
          title={value ? label : `${label} — derived from the phone's area code`}
        >
          <Icon className="h-3 w-3 shrink-0" />
          {readOnly ? (
            shown
          ) : (
            <button type="button" onClick={() => (open ? close() : setOpen(true))} className="inline-flex items-center gap-1 hover:opacity-80" aria-label={`Change ${label.toLowerCase()}`}>
              {shown}
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>
          )}
          {!readOnly && value && (
            <button
              type="button"
              onClick={() => void pick(null)}
              disabled={busy}
              aria-label={`Clear ${label.toLowerCase()}`}
              className="ml-0.5 hover:opacity-70 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => (open ? close() : setOpen(true))}
          className={pillBase + " border border-dashed border-border text-text-muted hover:border-accent hover:text-accent-ink"}
        >
          <Plus className="h-3 w-3 shrink-0" /> {label}
        </button>
      )}

      {open && !readOnly && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={pop}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: POP_W, zIndex: 1000 }}
          className="rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setErr(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (filtered.length === 1) void pick(filtered[0]);
                else if (onCreate && q.trim() && !exactMatch) void create();
              }
              if (e.key === "Escape") close();
            }}
            placeholder={createHint ?? `Search ${label.toLowerCase()}…`}
            className="mb-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="max-h-56 overflow-auto">
            {filtered.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => void pick(o)}
                disabled={busy}
                className={
                  "block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2 disabled:opacity-50 " +
                  (o === value ? "bg-accent-soft text-accent-ink" : "text-text")
                }
              >
                {o}
              </button>
            ))}
            {filtered.length === 0 && (!onCreate || !q.trim()) && (
              <div className="px-2 py-1.5 text-xs text-text-faint">
                {options.length === 0 ? "Nothing here yet." : "No match."}
              </div>
            )}
          </div>
          {onCreate && q.trim() && !exactMatch && (
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy}
              className="mt-1 flex w-full items-center gap-1.5 rounded border-t border-border-subtle px-2 py-1.5 text-left text-sm text-accent-ink hover:bg-surface-2 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add &ldquo;{q.trim()}&rdquo;
            </button>
          )}
          {value && (
            <button
              type="button"
              onClick={() => void pick(null)}
              disabled={busy}
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-dropped-fg hover:bg-surface-2 disabled:opacity-50"
            >
              Clear
            </button>
          )}
          {err && <p className="px-2 py-1 text-[11px] text-dropped-fg">{err}</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Area chip — the manual US-state override over the phone-derived region. */
export function AreaChip({
  value,
  derived,
  onSelect,
  readOnly = false,
}: {
  value: string | null;
  derived?: string | null;
  onSelect: (v: string | null) => void | Promise<void>;
  readOnly?: boolean;
}) {
  return (
    <ChipSelect
      icon={MapPin}
      label="Area"
      value={value}
      derived={derived}
      options={US_STATES}
      onSelect={onSelect}
      readOnly={readOnly}
    />
  );
}

/**
 * Category chip — options come from the shared catalog, fetched on first
 * open; an unmatched name can be added to the catalog on the spot.
 */
export function CategoryChip({
  value,
  onSelect,
  readOnly = false,
}: {
  value: string | null;
  onSelect: (v: string | null) => void | Promise<void>;
  readOnly?: boolean;
}) {
  const [options, setOptions] = useState<string[] | null>(null);

  useEffect(() => {
    if (readOnly) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/leads/categories");
        if (!res.ok) return;
        const body = await res.json();
        if (active) setOptions(((body.categories ?? []) as { name: string }[]).map((c) => c.name));
      } catch {
        /* popover just shows an empty list; adding still works */
      }
    })();
    return () => { active = false; };
  }, [readOnly]);

  async function createCategory(name: string): Promise<string | null> {
    const res = await fetch("/api/leads/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Could not add the category");
    const created = (body.category as { name: string } | undefined)?.name ?? name;
    setOptions((prev) => (prev && !prev.some((p) => p.toLowerCase() === created.toLowerCase()) ? [...prev, created].sort() : prev));
    return created;
  }

  return (
    <ChipSelect
      icon={Shapes}
      label="Category"
      value={value}
      options={options ?? []}
      onSelect={onSelect}
      onCreate={createCategory}
      createHint="Search or add a category…"
      readOnly={readOnly}
    />
  );
}
