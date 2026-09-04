"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Select } from "@/components/common/Select";
import { cn } from "@/lib/utils";

/**
 * The dashboard's date and time inputs.
 *
 * Nothing in the app renders a native `<input type="date|time|datetime-local">`
 * any more: those look different in every browser, and the operator wants one
 * calendar and one time control everywhere. Three pieces, one design:
 *
 *   - `DatePicker`     — a field that opens the calendar. Value `YYYY-MM-DD`.
 *   - `TimeField`      — typed hour and minute, AM/PM from a list. Value `HH:MM`
 *                        (24-hour, what a `time` column and the APIs expect).
 *   - `DateTimeField`  — both, side by side. Value `YYYY-MM-DDTHH:MM`, local
 *                        time — byte-for-byte what `datetime-local` produced,
 *                        so every caller's parsing and every API contract is
 *                        untouched by the swap.
 *
 * Values stay strings in the native formats deliberately; an empty string is
 * "nothing chosen", exactly as before.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` → parts, or null for anything else. */
export function parseDateValue(v: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate()) return null;
  return { y, m: mo, d };
}

export const toDateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Sep 4, 2026" for the field; "" for an empty or malformed value. */
export function formatDateLabel(v: string): string {
  const p = parseDateValue(v);
  return p ? `${MONTHS_SHORT[p.m - 1]} ${p.d}, ${p.y}` : "";
}

/** `HH:MM` (24h) → 12-hour parts, or null. */
export function parseTimeValue(v: string): { h12: number; minute: number; period: "AM" | "PM" } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]), minute = Number(m[2]);
  if (h > 23 || minute > 59) return null;
  return { h12: h % 12 === 0 ? 12 : h % 12, minute, period: h >= 12 ? "PM" : "AM" };
}

const fieldBase =
  "rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent disabled:opacity-60";

/* ------------------------------------------------------------------ */
/* Calendar popover                                                    */
/* ------------------------------------------------------------------ */

const POP_W = 288;
const POP_H = 340;

/** Fixed-position coordinates for a popover under (or, near the bottom of
 *  the viewport, above) its anchor. Portalled to <body> so a modal's
 *  overflow clipping can never cut the calendar off. */
function popoverPosition(anchor: HTMLElement): { top: number; left: number } {
  const r = anchor.getBoundingClientRect();
  const below = r.bottom + 6;
  const fitsBelow = below + POP_H <= window.innerHeight;
  const top = fitsBelow || r.top - POP_H - 6 < 0 ? below : r.top - POP_H - 6;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
  return { top, left };
}

function Calendar({
  value,
  onPick,
  onClear,
}: {
  value: string;
  onPick: (v: string) => void;
  onClear: () => void;
}) {
  const selected = parseDateValue(value);
  const now = new Date();
  const [view, setView] = useState(() =>
    selected ? { y: selected.y, m: selected.m } : { y: now.getFullYear(), m: now.getMonth() + 1 },
  );

  const daysInMonth = new Date(view.y, view.m, 0).getDate();
  const firstWeekday = new Date(view.y, view.m - 1, 1).getDay();
  const cells: (number | null)[] = [...Array<null>(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (delta: number) => {
    const d = new Date(view.y, view.m - 1 + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() + 1 });
  };
  const todayValue = toDateValue(now);

  return (
    <div className="w-[288px] rounded-lg border border-border bg-surface p-3 shadow-lg" role="dialog" aria-label="Choose a date">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label="Previous month"
          className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-semibold text-text" aria-live="polite">
          {MONTHS[view.m - 1]} {view.y}
        </div>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="Next month"
          className="rounded-md p-1.5 text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-[10px] font-medium uppercase tracking-wide text-text-faint">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const v = `${view.y}-${pad(view.m)}-${pad(day)}`;
          const isSelected = v === value;
          const isToday = v === todayValue;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onPick(v)}
              aria-label={`${MONTHS[view.m - 1]} ${day}, ${view.y}`}
              aria-pressed={isSelected}
              className={cn(
                "mx-auto flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors",
                isSelected
                  ? "bg-accent font-semibold text-white"
                  : "text-text hover:bg-accent-soft hover:text-accent-ink",
                isToday && !isSelected && "font-semibold text-accent-ink ring-1 ring-inset ring-accent/50",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <button
          type="button"
          onClick={() => onPick(todayValue)}
          className="rounded-md px-2 py-1 text-xs font-medium text-accent-ink hover:bg-accent-soft"
        >
          Today
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface-2 hover:text-text"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

export function DatePicker({
  value,
  onChange,
  className,
  placeholder = "Pick a date",
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  /** `YYYY-MM-DD` or "". */
  value: string;
  onChange: (v: string) => void;
  /** Applied to the field itself — pass the same classes as sibling inputs. */
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = () => {
    setOpen(false);
    setPos(null);
  };

  // Position while open; tracks resize and any ancestor scroll.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (anchor.current) setPos(popoverPosition(anchor.current));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Outside click / Escape closes. State setters are stable, so this needs
  // no dependency on `close`.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
      setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPos(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = formatDateLabel(value);

  return (
    <>
      <button
        ref={anchor}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-date-picker
        data-value={value}
        className={cn(fieldBase, "flex items-center gap-2 px-3 py-2 text-left", className)}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
        <span className={cn("flex-1 truncate", !label && "text-text-faint")}>{label || placeholder}</span>
        {label && !disabled && (
          <span
            role="button"
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="rounded p-0.5 text-text-faint hover:bg-surface-2 hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div ref={pop} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000 }}>
            <Calendar
              value={value}
              onPick={(v) => {
                onChange(v);
                close();
              }}
              onClear={() => {
                onChange("");
                close();
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

export function TimeField({
  value,
  onChange,
  className,
  disabled,
  "aria-label": ariaLabel = "Time",
}: {
  /** `HH:MM`, 24-hour, or "". */
  value: string;
  onChange: (v: string) => void;
  /** Applied to the hour and minute boxes and the AM/PM list. */
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const initial = parseTimeValue(value);
  const [hour, setHour] = useState(initial ? String(initial.h12) : "");
  const [minute, setMinute] = useState(initial ? pad(initial.minute) : "");
  const [period, setPeriod] = useState<"AM" | "PM">(initial?.period ?? "AM");
  // What THIS field last told its parent. A value that differs from it came
  // from outside (a quick preset, a reset) and refills the boxes; a value
  // that matches is our own echo and must not clobber half-typed text.
  const emitted = useRef(value);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const p = parseTimeValue(value);
    setHour(p ? String(p.h12) : "");
    setMinute(p ? pad(p.minute) : "");
    setPeriod(p?.period ?? "AM");
  }, [value]);

  const emit = (h: string, m: string, per: "AM" | "PM") => {
    const hn = Number(h);
    if (h === "" || !Number.isInteger(hn) || hn < 1 || hn > 12) {
      emitted.current = "";
      onChange("");
      return;
    }
    const mn = m === "" ? 0 : Number(m);
    if (!Number.isInteger(mn) || mn < 0 || mn > 59) return;
    const out = `${pad((hn % 12) + (per === "PM" ? 12 : 0))}:${pad(mn)}`;
    emitted.current = out;
    onChange(out);
  };

  const digits = (s: string) => s.replace(/\D/g, "").slice(0, 2);
  const box = cn(fieldBase, "w-12 px-0 py-2 text-center tabular-nums", className);

  return (
    <div className="inline-flex items-center gap-1.5" role="group" aria-label={ariaLabel}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="hh"
        aria-label="Hour"
        disabled={disabled}
        value={hour}
        onChange={(e) => {
          const h = digits(e.target.value);
          setHour(h);
          emit(h, minute, period);
        }}
        onBlur={() => {
          const hn = Number(hour);
          if (hour !== "" && hn >= 1 && hn <= 12) setHour(String(hn));
        }}
        className={box}
      />
      <span className="text-sm text-text-faint">:</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="mm"
        aria-label="Minute"
        disabled={disabled}
        value={minute}
        onChange={(e) => {
          const m = digits(e.target.value);
          setMinute(m);
          emit(hour, m, period);
        }}
        onBlur={() => {
          const mn = Number(minute);
          if (minute !== "" && mn >= 0 && mn <= 59) setMinute(pad(mn));
          else if (minute === "" && hour !== "") setMinute("00");
        }}
        className={box}
      />
      <Select
        aria-label="AM or PM"
        disabled={disabled}
        value={period}
        onChange={(e) => {
          const per = e.target.value as "AM" | "PM";
          setPeriod(per);
          emit(hour, minute, per);
        }}
        className={cn(fieldBase, "px-2.5 py-2", className)}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </Select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Date + time                                                         */
/* ------------------------------------------------------------------ */

export function DateTimeField({
  value,
  onChange,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  /** `YYYY-MM-DDTHH:MM` (local) or "". */
  value: string;
  onChange: (v: string) => void;
  /** Sizing/visual classes for the DATE field. `w-full` is dropped — the date
   *  and the time controls share one row — and the time boxes never take it:
   *  a full-width hour box and a zero-width AM/PM list is what leaking a
   *  caller's input class into them produced. */
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const dateClass = (className ?? "").replace(/w-full/g, "").trim();
  const split = (v: string): [string, string] => {
    const i = v.indexOf("T");
    return i === -1 ? [v, ""] : [v.slice(0, i), v.slice(i + 1, i + 6)];
  };
  const [initialDate, initialTime] = split(value);
  // The date is kept here as well as in `value` so that clearing the hour box
  // to retype it (which makes the whole value "" — a half time is no time)
  // does not also wipe the date the user already picked.
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const emitted = useRef(value);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const [d, t] = split(value);
    setDate(d);
    setTime(t);
  }, [value]);

  const emit = (d: string, t: string) => {
    const out = d && t ? `${d}T${t}` : "";
    emitted.current = out;
    onChange(out);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-datetime-field data-value={value}>
      <DatePicker
        value={date}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} date` : "Date"}
        className={cn("min-w-[170px] flex-1", dateClass)}
        onChange={(d) => {
          // Picking a day before any time was typed uses the current time, so
          // the field is complete in one click — the way the presets are.
          const t = d && !time ? toTimeValue(new Date()) : time;
          setDate(d);
          setTime(t);
          emit(d, t);
        }}
      />
      <TimeField
        value={time}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} time` : "Time"}
        onChange={(t) => {
          const d = t && !date ? toDateValue(new Date()) : date;
          setDate(d);
          setTime(t);
          emit(d, t);
        }}
      />
    </div>
  );
}
