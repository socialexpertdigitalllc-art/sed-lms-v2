// lib/contracts/payments.ts
/**
 * How the client pays the one-time fee: in full, a deposit and a balance, or
 * installments. PURE and client-safe — the composer edits a plan, the create
 * route validates and stores it (contracts.payment_plan), and the merge turns
 * it into contract wording ({{payment_terms}} and friends).
 *
 * A plan is just an ordered list of payments, each an amount and WHEN it is
 * due. The presets are only shortcuts for building that list.
 */
import { formatUsd } from "./merge";

export type PaymentDueKind =
  | "signing" // upon signing this agreement (upfront)
  | "work_start" // when work on the project begins
  | "completion" // on completion, before the site goes live
  | "date" // on a fixed date
  | "days_after" // N days after signing
  | "weeks_after"
  | "months_after"
  | "custom"; // free text

export interface PaymentDue {
  kind: PaymentDueKind;
  /** days/weeks/months_after: how many. */
  count?: number;
  /** date: YYYY-MM-DD. */
  date?: string;
  /** custom: the wording, e.g. "when the domain is connected". */
  text?: string;
}

export interface PaymentRow {
  amount: number;
  due: PaymentDue;
  /** Optional label, e.g. "Deposit". */
  label?: string;
}

export interface PaymentPlan {
  payments: PaymentRow[];
}

export const PAYMENT_DUE_KINDS: { kind: PaymentDueKind; label: string }[] = [
  { kind: "signing", label: "Upon signing (upfront)" },
  { kind: "work_start", label: "When work begins" },
  { kind: "completion", label: "On completion, before launch" },
  { kind: "date", label: "On a date" },
  { kind: "days_after", label: "Days after signing" },
  { kind: "weeks_after", label: "Weeks after signing" },
  { kind: "months_after", label: "Months after signing" },
  { kind: "custom", label: "Other (write it)" },
];

const KINDS = new Set(PAYMENT_DUE_KINDS.map((k) => k.kind));
export const MAX_PAYMENTS = 24;

/** Money in cents, to keep splits and totals exact. */
const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;

/** "December 1, 2026" from YYYY-MM-DD (no timezone drift). */
function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
  return `${month} ${d}, ${y}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** When a payment is due, as contract wording. */
export function describeDue(due: PaymentDue): string {
  switch (due.kind) {
    case "signing":
      return "upon signing this agreement";
    case "work_start":
      return "when work on the project begins";
    case "completion":
      return "upon completion of the work, before the website goes live";
    case "date":
      return due.date ? `on or before ${longDate(due.date)}` : "on the agreed date";
    case "days_after":
      return `${plural(due.count ?? 0, "day")} after signing`;
    case "weeks_after":
      return `${plural(due.count ?? 0, "week")} after signing`;
    case "months_after":
      return `${plural(due.count ?? 0, "month")} after signing`;
    case "custom":
      return (due.text ?? "").trim() || "as agreed";
  }
}

export function planTotal(plan: PaymentPlan): number {
  return fromCents(plan.payments.reduce((s, p) => s + cents(p.amount), 0));
}

/** True when the whole fee is due upfront in one payment — the default. */
export function isPaidInFull(plan: PaymentPlan | null | undefined): boolean {
  return !plan || plan.payments.length === 0 || (plan.payments.length === 1 && plan.payments[0].due.kind === "signing");
}

/* ----------------------------------------------------------- validation */

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * A plan from a request body. Amounts must be positive and add up EXACTLY to
 * the one-time fee — a schedule that doesn't is a contract that contradicts
 * itself. Null/absent = paid in full.
 */
export function parsePaymentPlan(raw: unknown, oneTimePrice: number | null): Parsed<PaymentPlan | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "payment_plan must be an object" };
  const list = (raw as { payments?: unknown }).payments;
  if (!Array.isArray(list) || list.length === 0) return { ok: true, value: null };
  if (list.length > MAX_PAYMENTS) return { ok: false, message: `A schedule can have at most ${MAX_PAYMENTS} payments.` };
  const payments: PaymentRow[] = [];
  for (const [i, item] of list.entries()) {
    const n = i + 1;
    if (!item || typeof item !== "object") return { ok: false, message: `Payment ${n} is malformed.` };
    const r = item as { amount?: unknown; due?: unknown; label?: unknown };
    if (typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount <= 0) {
      return { ok: false, message: `Payment ${n} needs an amount above zero.` };
    }
    const d = (r.due ?? {}) as { kind?: unknown; count?: unknown; date?: unknown; text?: unknown };
    if (typeof d.kind !== "string" || !KINDS.has(d.kind as PaymentDueKind)) return { ok: false, message: `Payment ${n} needs a due date or event.` };
    const due: PaymentDue = { kind: d.kind as PaymentDueKind };
    if (due.kind === "days_after" || due.kind === "weeks_after" || due.kind === "months_after") {
      if (typeof d.count !== "number" || !Number.isInteger(d.count) || d.count < 1 || d.count > 1000) {
        return { ok: false, message: `Payment ${n}: how many ${due.kind.split("_")[0]} after signing?` };
      }
      due.count = d.count;
    }
    if (due.kind === "date") {
      if (!isYmd(d.date)) return { ok: false, message: `Payment ${n} needs a date.` };
      due.date = d.date;
    }
    if (due.kind === "custom") {
      const text = typeof d.text === "string" ? d.text.trim() : "";
      if (!text) return { ok: false, message: `Payment ${n}: say when it is due.` };
      due.text = text.slice(0, 200);
    }
    const row: PaymentRow = { amount: fromCents(cents(r.amount)), due };
    if (typeof r.label === "string" && r.label.trim()) row.label = r.label.trim().slice(0, 40);
    payments.push(row);
  }
  if (oneTimePrice !== null && cents(planTotal({ payments })) !== cents(oneTimePrice)) {
    return {
      ok: false,
      message: `The payments add up to ${formatUsd(planTotal({ payments }))}, but the one-time price is ${formatUsd(oneTimePrice)}.`,
    };
  }
  return { ok: true, value: { payments } };
}

/* -------------------------------------------------------------- presets */

export function paidInFull(total: number): PaymentPlan {
  return { payments: [{ amount: total, due: { kind: "signing" } }] };
}

/** A deposit now, the rest at `balanceDue` (default: when work begins). */
export function depositAndBalance(total: number, deposit: number, balanceDue: PaymentDue = { kind: "work_start" }): PaymentPlan {
  const dep = Math.min(cents(deposit), cents(total));
  const rest = cents(total) - dep;
  const payments: PaymentRow[] = [{ amount: fromCents(dep), due: { kind: "signing" }, label: "Deposit" }];
  if (rest > 0) payments.push({ amount: fromCents(rest), due: balanceDue, label: "Balance" });
  return { payments };
}

/** `count` equal payments (any leftover cent on the last), the first upon
 *  signing, then one every `every` weeks or months. */
export function installments(total: number, count: number, every: { unit: "weeks" | "months"; n: number }): PaymentPlan {
  const k = Math.max(2, Math.min(MAX_PAYMENTS, Math.floor(count)));
  const each = Math.floor(cents(total) / k);
  const payments: PaymentRow[] = [];
  for (let i = 0; i < k; i++) {
    const amount = i === k - 1 ? cents(total) - each * (k - 1) : each;
    const due: PaymentDue =
      i === 0 ? { kind: "signing" } : { kind: every.unit === "weeks" ? "weeks_after" : "months_after", count: every.n * i };
    payments.push({ amount: fromCents(amount), due });
  }
  return { payments };
}

/** Move the difference between the schedule and the fee onto the last payment. */
export function balanceLastPayment(plan: PaymentPlan, total: number): PaymentPlan {
  if (!plan.payments.length) return paidInFull(total);
  const others = plan.payments.slice(0, -1).reduce((s, p) => s + cents(p.amount), 0);
  const last = { ...plan.payments[plan.payments.length - 1], amount: fromCents(Math.max(0, cents(total) - others)) };
  return { payments: [...plan.payments.slice(0, -1), last] };
}

/* -------------------------------------------------------------- wording */

/** "1. $600.00 (Deposit) — due upon signing this agreement" lines. */
export function scheduleLines(plan: PaymentPlan): string[] {
  return plan.payments.map(
    (p, i) => `${i + 1}. ${formatUsd(p.amount)}${p.label ? ` (${p.label})` : ""} — due ${describeDue(p.due)}`,
  );
}

/**
 * The payment clause for {{payment_terms}}: one sentence when paid in full,
 * otherwise an intro line and the numbered schedule (one paragraph each).
 */
export function paymentTermsText(plan: PaymentPlan | null, oneTimePrice: number | null): string {
  const fee = formatUsd(oneTimePrice);
  if (isPaidInFull(plan)) return `The one-time fee of ${fee} is due in full upon signing this agreement.`;
  const n = plan!.payments.length;
  if (n === 1) return `The one-time fee of ${fee} is due in full ${describeDue(plan!.payments[0].due)}.`;
  const intro =
    n === 2 && plan!.payments[0].due.kind === "signing"
      ? `The one-time fee of ${fee} will be paid in two parts: an upfront payment upon signing and the remaining balance as scheduled below.`
      : `The one-time fee of ${fee} will be paid in ${n} installments, as follows:`;
  return [intro, ...scheduleLines(plan!)].join("\n");
}

/** Every payment-related merge value, for buildReplacements. */
export function paymentReplacements(plan: PaymentPlan | null, oneTimePrice: number | null): { token: string; value: string }[] {
  const full = isPaidInFull(plan);
  const first = full ? oneTimePrice : plan!.payments[0].amount;
  const balance = oneTimePrice !== null && first !== null ? fromCents(cents(oneTimePrice) - cents(first)) : null;
  return [
    { token: "{{payment_terms}}", value: paymentTermsText(plan, oneTimePrice) },
    { token: "{{payment_schedule}}", value: full ? `1. ${formatUsd(oneTimePrice)} — due upon signing this agreement` : scheduleLines(plan!).join("\n") },
    { token: "{{deposit_amount}}", value: formatUsd(first) },
    { token: "{{balance_amount}}", value: formatUsd(balance) },
    { token: "{{installment_count}}", value: String(full ? 1 : plan!.payments.length) },
  ];
}
