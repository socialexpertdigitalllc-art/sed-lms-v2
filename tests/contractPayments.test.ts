import { describe, it, expect } from "vitest";
import {
  describeDue,
  parsePaymentPlan,
  depositAndBalance,
  installments,
  balanceLastPayment,
  paymentTermsText,
  paymentReplacements,
  isPaidInFull,
  planTotal,
  type PaymentPlan,
} from "@/lib/contracts/payments";
import { buildReplacements } from "@/lib/contracts/placeholders";
import { getContractTemplate, nodeText, nodeVisible } from "@/lib/contracts/templates";

/**
 * Payment schedules: what the agent picks in the composer, what the server
 * accepts, and the wording that lands in the contract.
 */

const value = (r: ReturnType<typeof parsePaymentPlan>) => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

describe("describeDue — when a payment is due, as contract wording", () => {
  it("words every kind", () => {
    expect(describeDue({ kind: "signing" })).toBe("upon signing this agreement");
    expect(describeDue({ kind: "work_start" })).toBe("when work on the project begins");
    expect(describeDue({ kind: "completion" })).toBe("upon completion of the work, before the website goes live");
    expect(describeDue({ kind: "date", date: "2026-12-01" })).toBe("on or before December 1, 2026");
    expect(describeDue({ kind: "days_after", count: 1 })).toBe("1 day after signing");
    expect(describeDue({ kind: "weeks_after", count: 2 })).toBe("2 weeks after signing");
    expect(describeDue({ kind: "months_after", count: 3 })).toBe("3 months after signing");
    expect(describeDue({ kind: "custom", text: "  when the domain is connected " })).toBe("when the domain is connected");
  });
});

describe("parsePaymentPlan — the server's check", () => {
  it("no plan = paid in full", () => {
    expect(value(parsePaymentPlan(undefined, 1200))).toBeNull();
    expect(value(parsePaymentPlan(null, 1200))).toBeNull();
    expect(value(parsePaymentPlan({ payments: [] }, 1200))).toBeNull();
  });

  it("accepts a deposit + balance that adds up to the fee", () => {
    const plan = value(parsePaymentPlan({ payments: [
      { amount: 600, due: { kind: "signing" }, label: " Deposit " },
      { amount: 600, due: { kind: "work_start" } },
    ] }, 1200));
    expect(plan).toEqual({ payments: [
      { amount: 600, due: { kind: "signing" }, label: "Deposit" },
      { amount: 600, due: { kind: "work_start" } },
    ] });
  });

  it("refuses a schedule that doesn't add up to the fee, to the cent", () => {
    const r = parsePaymentPlan({ payments: [{ amount: 600, due: { kind: "signing" } }, { amount: 599.99, due: { kind: "completion" } }] }, 1200);
    expect(r).toEqual({ ok: false, message: "The payments add up to $1,199.99, but the one-time price is $1,200.00." });
  });

  it("adds money in cents (no 0.1 + 0.2 drift)", () => {
    const r = parsePaymentPlan({ payments: [{ amount: 0.1, due: { kind: "signing" } }, { amount: 0.2, due: { kind: "completion" } }] }, 0.3);
    expect(r.ok).toBe(true);
  });

  it("refuses bad rows with a message naming the payment", () => {
    const one = (row: unknown) => parsePaymentPlan({ payments: [{ amount: 100, due: { kind: "signing" } }, row] }, 200);
    expect(one({ amount: 0, due: { kind: "signing" } })).toMatchObject({ ok: false, message: "Payment 2 needs an amount above zero." });
    expect(one({ amount: 100, due: { kind: "whenever" } })).toMatchObject({ ok: false, message: "Payment 2 needs a due date or event." });
    expect(one({ amount: 100, due: { kind: "months_after" } })).toMatchObject({ ok: false, message: "Payment 2: how many months after signing?" });
    expect(one({ amount: 100, due: { kind: "date", date: "next week" } })).toMatchObject({ ok: false, message: "Payment 2 needs a date." });
    expect(one({ amount: 100, due: { kind: "custom", text: "  " } })).toMatchObject({ ok: false, message: "Payment 2: say when it is due." });
    expect(parsePaymentPlan("full", 200)).toMatchObject({ ok: false });
    expect(parsePaymentPlan({ payments: Array.from({ length: 25 }, () => ({ amount: 1, due: { kind: "signing" } })) }, 25)).toMatchObject({ ok: false });
  });

  it("keeps only the fields a due kind uses", () => {
    const plan = value(parsePaymentPlan({ payments: [
      { amount: 50, due: { kind: "signing", count: 9, date: "2026-01-01", text: "x" } },
      { amount: 50, due: { kind: "date", date: "2026-11-30", count: 3 } },
    ] }, 100));
    expect(plan!.payments.map((p) => p.due)).toEqual([{ kind: "signing" }, { kind: "date", date: "2026-11-30" }]);
  });
});

describe("presets", () => {
  it("deposit + balance; the balance is due when work begins unless told otherwise", () => {
    expect(depositAndBalance(1200, 500)).toEqual({ payments: [
      { amount: 500, due: { kind: "signing" }, label: "Deposit" },
      { amount: 700, due: { kind: "work_start" }, label: "Balance" },
    ] });
    expect(depositAndBalance(1200, 300, { kind: "completion" }).payments[1].due).toEqual({ kind: "completion" });
    // A deposit of the whole fee is just paid in full.
    expect(isPaidInFull(depositAndBalance(1200, 1500))).toBe(true);
  });

  it("installments split evenly, the odd cent on the last, first due at signing", () => {
    const plan = installments(1000, 3, { unit: "months", n: 1 });
    expect(plan.payments.map((p) => p.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(plan.payments.map((p) => p.due)).toEqual([
      { kind: "signing" },
      { kind: "months_after", count: 1 },
      { kind: "months_after", count: 2 },
    ]);
    expect(planTotal(plan)).toBe(1000);
    expect(installments(900, 3, { unit: "weeks", n: 2 }).payments[2].due).toEqual({ kind: "weeks_after", count: 4 });
  });

  it("balanceLastPayment moves the difference onto the last payment", () => {
    const off: PaymentPlan = { payments: [{ amount: 400, due: { kind: "signing" } }, { amount: 400, due: { kind: "completion" } }] };
    expect(balanceLastPayment(off, 1000).payments[1].amount).toBe(600);
  });
});

describe("contract wording", () => {
  it("paid in full is one sentence", () => {
    expect(paymentTermsText(null, 1200)).toBe("The one-time fee of $1,200.00 is due in full upon signing this agreement.");
    // One payment, but later: still one sentence.
    expect(paymentTermsText({ payments: [{ amount: 1200, due: { kind: "completion" } }] }, 1200)).toBe(
      "The one-time fee of $1,200.00 is due in full upon completion of the work, before the website goes live.",
    );
  });

  it("upfront + rest after work starts reads as two parts", () => {
    expect(paymentTermsText(depositAndBalance(1200, 600), 1200).split("\n")).toEqual([
      "The one-time fee of $1,200.00 will be paid in two parts: an upfront payment upon signing and the remaining balance as scheduled below.",
      "1. $600.00 (Deposit) — due upon signing this agreement",
      "2. $600.00 (Balance) — due when work on the project begins",
    ]);
  });

  it("installments list every payment", () => {
    const text = paymentTermsText(installments(900, 3, { unit: "months", n: 1 }), 900);
    expect(text.split("\n")).toEqual([
      "The one-time fee of $900.00 will be paid in 3 installments, as follows:",
      "1. $300.00 — due upon signing this agreement",
      "2. $300.00 — due 1 month after signing",
      "3. $300.00 — due 2 months after signing",
    ]);
  });

  it("fills the payment placeholders", () => {
    const plan = depositAndBalance(1200, 400);
    const map = Object.fromEntries(paymentReplacements(plan, 1200).map((r) => [r.token, r.value]));
    expect(map["{{deposit_amount}}"]).toBe("$400.00");
    expect(map["{{balance_amount}}"]).toBe("$800.00");
    expect(map["{{installment_count}}"]).toBe("2");
    expect(map["{{payment_schedule}}"].split("\n")).toHaveLength(2);

    const full = Object.fromEntries(paymentReplacements(null, 1200).map((r) => [r.token, r.value]));
    expect(full["{{deposit_amount}}"]).toBe("$1,200.00");
    expect(full["{{balance_amount}}"]).toBe("$0.00");
    expect(full["{{installment_count}}"]).toBe("1");
  });

  it("buildReplacements carries them alongside the lead's fields", () => {
    const s = {
      business_name: "Acme", business_phone: null, business_email: "a@acme.test",
      one_time_price: 1200, yearly_price: 300, agent_name: "Jo", contract_date: "2026-10-20",
    };
    const tokens = buildReplacements(s, { paymentPlan: depositAndBalance(1200, 600) }).map((r) => r.token);
    expect(tokens).toEqual(expect.arrayContaining(["{{one_time_price}}", "{{payment_terms}}", "{{payment_schedule}}", "{{deposit_amount}}"]));
    expect(buildReplacements(s).find((r) => r.token === "{{payment_terms}}")?.value).toMatch(/due in full upon signing/);
  });

  it("the built-in template prints the schedule only when it isn't paid in full", () => {
    const pricing = getContractTemplate("standard").sections.find((x) => /pricing/i.test(x.heading))!;
    const lines = (plan: PaymentPlan | null) => {
      const snap = { business_name: "Acme", business_phone: null, business_email: null, one_time_price: 1200, yearly_price: 300, agent_name: "", contract_date: "2026-10-20", payment_plan: plan };
      return pricing.nodes.filter((n) => nodeVisible(n, snap)).map((n) => (n.kind === "subhead" ? n.text : nodeText(n.text, snap)));
    };
    expect(lines(null).some((l) => l.includes("installments") || l.includes("two parts"))).toBe(false);
    expect(lines(depositAndBalance(1200, 600)).some((l) => l.includes("$600.00 (Deposit)"))).toBe(true);
  });
});
