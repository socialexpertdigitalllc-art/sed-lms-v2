"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Plus, Trash2, AlertTriangle, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputCls } from "@/components/forms/Field";
import { iconBtnDanger, btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import { formatUsd, parsePrice } from "@/lib/contracts/merge";
import {
  PAYMENT_DUE_KINDS,
  MAX_PAYMENTS,
  depositAndBalance,
  installments,
  parsePaymentPlan,
  paymentTermsText,
  isPaidInFull,
  type PaymentDue,
  type PaymentDueKind,
  type PaymentPlan,
} from "@/lib/contracts/payments";

/**
 * How the client pays the one-time fee. Presets fill in the rows; every row
 * stays editable. The last payment takes whatever the others leave, so
 * changing a deposit never leaves the schedule short of the fee.
 */

type Mode = "full" | "deposit" | "installments" | "custom";

type Row = { amount: string; due: PaymentDue; label: string };

const MODES: { mode: Mode; label: string }[] = [
  { mode: "full", label: "Paid in full" },
  { mode: "deposit", label: "Deposit + balance" },
  { mode: "installments", label: "Installments" },
  { mode: "custom", label: "Custom schedule" },
];

const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => String(Math.round(n * 100) / 100);

function toRows(plan: PaymentPlan): Row[] {
  return plan.payments.map((p) => ({ amount: money(p.amount), due: p.due, label: p.label ?? "" }));
}

function toPlan(rows: Row[]): PaymentPlan {
  return {
    payments: rows.map((r) => ({
      amount: parsePrice(r.amount) ?? 0,
      due: r.due,
      ...(r.label.trim() ? { label: r.label.trim() } : {}),
    })),
  };
}

/** The last row absorbs the difference (when that keeps it above zero). */
function settleLast(rows: Row[], total: number | null): Row[] {
  if (total === null || rows.length < 2) return rows;
  const others = rows.slice(0, -1).reduce((s, r) => s + cents(parsePrice(r.amount) ?? 0), 0);
  const rest = cents(total) - others;
  if (rest <= 0) return rows;
  return [...rows.slice(0, -1), { ...rows[rows.length - 1], amount: money(rest / 100) }];
}

function modeOf(plan: PaymentPlan | null): Mode {
  if (isPaidInFull(plan)) return "full";
  const p = plan!.payments;
  if (p.length === 2 && p[0].due.kind === "signing" && p[0].label === "Deposit") return "deposit";
  return "custom";
}

function DueFields({
  due,
  onChange,
  disabled,
  index,
  className,
}: {
  due: PaymentDue;
  onChange: (d: PaymentDue) => void;
  disabled?: boolean;
  index: number;
  className?: string;
}) {
  const needsCount = due.kind === "days_after" || due.kind === "weeks_after" || due.kind === "months_after";
  return (
    <div className={cn("flex min-w-0 flex-1 flex-wrap gap-2", className)}>
      <select
        className={cn(inputCls, "w-auto min-w-0 flex-1 py-1.5")}
        value={due.kind}
        disabled={disabled}
        aria-label={`Payment ${index + 1} due`}
        onChange={(e) => {
          const kind = e.target.value as PaymentDueKind;
          onChange({ kind, ...(kind.endsWith("_after") ? { count: due.count ?? 1 } : {}), ...(kind === "date" ? { date: due.date ?? "" } : {}), ...(kind === "custom" ? { text: due.text ?? "" } : {}) });
        }}
      >
        {PAYMENT_DUE_KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>{k.label}</option>
        ))}
      </select>
      {needsCount && (
        <input
          type="number"
          min={1}
          max={1000}
          className={cn(inputCls, "tabular w-20 py-1.5 font-mono")}
          value={due.count ?? ""}
          disabled={disabled}
          aria-label={`Payment ${index + 1}: how many ${due.kind.split("_")[0]}`}
          onChange={(e) => onChange({ ...due, count: e.target.value === "" ? undefined : Math.max(0, Math.floor(Number(e.target.value))) })}
        />
      )}
      {due.kind === "date" && (
        <input
          type="date"
          className={cn(inputCls, "tabular w-auto py-1.5 font-mono")}
          value={due.date ?? ""}
          disabled={disabled}
          aria-label={`Payment ${index + 1} date`}
          onChange={(e) => onChange({ ...due, date: e.target.value })}
        />
      )}
      {due.kind === "custom" && (
        <input
          className={cn(inputCls, "min-w-[12rem] flex-[2] py-1.5")}
          value={due.text ?? ""}
          disabled={disabled}
          maxLength={200}
          placeholder="e.g. when the domain is connected"
          aria-label={`Payment ${index + 1}: when it is due`}
          onChange={(e) => onChange({ ...due, text: e.target.value })}
        />
      )}
    </div>
  );
}

export function PaymentPlanEditor({
  total,
  initial = null,
  onChange,
  disabled,
}: {
  /** The one-time price the schedule must add up to (null = not set yet). */
  total: number | null;
  initial?: PaymentPlan | null;
  /** The plan (null = paid in full) and whether it is valid against `total`. */
  onChange: (plan: PaymentPlan | null, error: string | null) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(() => modeOf(initial));
  const [rows, setRows] = useState<Row[]>(() => (initial && !isPaidInFull(initial) ? toRows(initial) : []));
  const [deposit, setDeposit] = useState(() => (initial && modeOf(initial) === "deposit" ? money(initial.payments[0].amount) : ""));
  const [count, setCount] = useState(3);
  const [every, setEvery] = useState<{ unit: "weeks" | "months"; n: number }>({ unit: "months", n: 1 });

  const plan = mode === "full" ? null : toPlan(rows);
  const check = plan ? parsePaymentPlan(plan, total) : ({ ok: true, value: null } as const);
  const error = check.ok ? null : check.message;

  // Report upward whenever the plan or its validity changes.
  const report = useEffectEvent(() => onChange(plan, error));
  const key = JSON.stringify(plan) + "|" + error;
  useEffect(() => {
    report();
  }, [key]);

  // A changed price re-balances the schedule (adjusting state while rendering,
  // React's pattern for state that follows a prop).
  const [seenTotal, setSeenTotal] = useState(total);
  if (seenTotal !== total) {
    setSeenTotal(total);
    if (mode !== "full" && total !== null) {
      if (mode === "installments") setRows(toRows(installments(total, count, every)));
      else if (mode === "deposit") setRows(toRows(depositAndBalance(total, parsePrice(deposit) ?? total / 2, rows[1]?.due)));
      else setRows(settleLast(rows, total));
    }
  }

  function pick(next: Mode) {
    setMode(next);
    const t = total ?? 0;
    if (next === "full") setRows([]);
    if (next === "deposit") {
      const dep = parsePrice(deposit) ?? Math.round(t * 50) / 100;
      setDeposit(money(dep));
      setRows(toRows(depositAndBalance(t, dep)));
    }
    if (next === "installments") setRows(toRows(installments(t, count, every)));
    if (next === "custom" && rows.length === 0) setRows(toRows(depositAndBalance(t, Math.round(t * 50) / 100)));
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => {
      const next = prev.map((r, j) => (j === i ? { ...r, ...patch } : r));
      // Editing an earlier amount: the last payment takes up the difference.
      return patch.amount !== undefined && i < next.length - 1 ? settleLast(next, total) : next;
    });
  }

  const sum = rows.reduce((s, r) => s + cents(parsePrice(r.amount) ?? 0), 0) / 100;
  const off = total !== null && mode !== "full" && cents(sum) !== cents(total);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How the client pays">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            disabled={disabled}
            onClick={() => pick(m.mode)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60",
              mode === m.mode ? "border-accent bg-accent-soft font-medium text-accent-ink" : "border-border text-text-muted hover:bg-surface-2",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "deposit" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] text-text-muted">Upfront deposit</span>
            <input
              className={cn(inputCls, "tabular w-32 py-1.5 font-mono")}
              value={deposit}
              inputMode="decimal"
              disabled={disabled}
              onChange={(e) => {
                setDeposit(e.target.value);
                const dep = parsePrice(e.target.value);
                if (dep !== null && total !== null) setRows((r) => toRows(depositAndBalance(total, dep, r[1]?.due)));
              }}
              aria-label="Upfront deposit"
            />
          </label>
          <div className="flex gap-1">
            {[25, 30, 50].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={disabled || total === null}
                className={btnGhostSm}
                onClick={() => {
                  if (total === null) return;
                  const dep = Math.round(total * pct) / 100;
                  setDeposit(money(dep));
                  setRows((r) => toRows(depositAndBalance(total, dep, r[1]?.due)));
                }}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "installments" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] text-text-muted">Payments</span>
            <input
              type="number"
              min={2}
              max={MAX_PAYMENTS}
              className={cn(inputCls, "tabular w-20 py-1.5 font-mono")}
              value={count}
              disabled={disabled}
              onChange={(e) => {
                const n = Math.max(2, Math.min(MAX_PAYMENTS, Math.floor(Number(e.target.value) || 2)));
                setCount(n);
                if (total !== null) setRows(toRows(installments(total, n, every)));
              }}
              aria-label="Number of payments"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-text-muted">One every</span>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={52}
                className={cn(inputCls, "tabular w-16 py-1.5 font-mono")}
                value={every.n}
                disabled={disabled}
                onChange={(e) => {
                  const next = { ...every, n: Math.max(1, Math.min(52, Math.floor(Number(e.target.value) || 1))) };
                  setEvery(next);
                  if (total !== null) setRows(toRows(installments(total, count, next)));
                }}
                aria-label="Interval"
              />
              <select
                className={cn(inputCls, "w-auto py-1.5")}
                value={every.unit}
                disabled={disabled}
                onChange={(e) => {
                  const next = { ...every, unit: e.target.value as "weeks" | "months" };
                  setEvery(next);
                  if (total !== null) setRows(toRows(installments(total, count, next)));
                }}
                aria-label="Interval unit"
              >
                <option value="weeks">week(s)</option>
                <option value="months">month(s)</option>
              </select>
            </div>
          </label>
          <p className="pb-2 text-[11px] text-text-faint">The first payment is due upon signing.</p>
        </div>
      )}

      {mode !== "full" && (
        <div className="rounded-md border border-border">
          <ol className="divide-y divide-border-subtle">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2">
                {/* Phone: number, amount, label, remove — then "due" on its own line. */}
                <span className="tabular w-5 shrink-0 font-mono text-xs text-text-faint">{i + 1}.</span>
                <input
                  className={cn(inputCls, "tabular w-28 py-1.5 font-mono")}
                  value={r.amount}
                  inputMode="decimal"
                  disabled={disabled}
                  onChange={(e) => {
                    if (mode === "installments") setMode("custom");
                    if (mode === "deposit" && i === 0) setDeposit(e.target.value);
                    setRow(i, { amount: e.target.value });
                  }}
                  aria-label={`Payment ${i + 1} amount`}
                />
                <DueFields
                  className="order-last basis-full sm:order-none sm:basis-0"
                  due={r.due}
                  index={i}
                  disabled={disabled}
                  onChange={(due) => {
                    if (mode === "installments") setMode("custom");
                    setRow(i, { due });
                  }}
                />
                <input
                  className={cn(inputCls, "w-auto min-w-0 flex-1 py-1.5 sm:w-28 sm:flex-none")}
                  value={r.label}
                  disabled={disabled}
                  maxLength={40}
                  placeholder="Label"
                  onChange={(e) => setRow(i, { label: e.target.value })}
                  aria-label={`Payment ${i + 1} label (optional)`}
                />
                <button
                  type="button"
                  className={iconBtnDanger}
                  disabled={disabled || rows.length <= 1}
                  title="Remove this payment"
                  aria-label={`Remove payment ${i + 1}`}
                  onClick={() => {
                    setMode("custom");
                    setRows((prev) => settleLast(prev.filter((_, j) => j !== i), total));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-2 px-3 py-2">
            <button
              type="button"
              className={btnSecondarySm}
              disabled={disabled || rows.length >= MAX_PAYMENTS}
              onClick={() => {
                setMode("custom");
                setRows((prev) => {
                  const last = prev[prev.length - 1];
                  const half = Math.floor(cents(parsePrice(last?.amount) ?? 0) / 2) / 100;
                  if (!last || half <= 0) return [...prev, { amount: "", due: { kind: "completion" }, label: "" }];
                  return [
                    ...prev.slice(0, -1),
                    { ...last, amount: money(half) },
                    { amount: money((cents(parsePrice(last.amount) ?? 0) - cents(half)) / 100), due: { kind: "completion" }, label: "" },
                  ];
                });
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add payment
            </button>
            <p className={cn("tabular font-mono text-xs", off ? "text-dropped-fg" : "text-text-muted")}>
              {formatUsd(sum)} of {formatUsd(total)}
            </p>
          </div>
        </div>
      )}

      {mode !== "full" && error && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-dropped-bg px-2.5 py-1.5 text-[11px] text-dropped-fg">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          {off && total !== null && rows.length > 0 && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium underline-offset-2 hover:underline"
              disabled={disabled}
              onClick={() => {
                const others = rows.slice(0, -1).reduce((s, r) => s + cents(parsePrice(r.amount) ?? 0), 0);
                const rest = cents(total) - others;
                if (rest > 0) setRows([...rows.slice(0, -1), { ...rows[rows.length - 1], amount: money(rest / 100) }]);
              }}
            >
              <Scale className="h-3.5 w-3.5" /> Put the difference on the last payment
            </button>
          )}
        </div>
      )}

      <div className="rounded-md bg-surface-2 px-3 py-2">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-text-faint">In the contract</p>
        <p className="whitespace-pre-line text-xs leading-relaxed text-text-muted">
          {total === null ? "Set the one-time price first." : paymentTermsText(mode === "full" ? null : check.ok ? check.value : plan, total)}
        </p>
      </div>
    </div>
  );
}
