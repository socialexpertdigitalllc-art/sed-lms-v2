/**
 * Human-readable copy for the machine-stable enums the engine emits.
 *
 * Pure and dependency-free — the engine never localises its own `ReasonCode`s
 * (see types.ts), so every surface that shows a result maps them here rather
 * than inventing its own wording.
 */
import type { ProviderName, ReasonCode, Verdict } from "./types";

const REASON_TEXT: Record<ReasonCode, string> = {
  // --- syntax ---
  syntax_empty: "No address entered.",
  syntax_at_count: "An address needs exactly one “@”.",
  syntax_local_empty: "Nothing before the “@”.",
  syntax_local_too_long: "The part before the “@” is too long.",
  syntax_local_dot: "The part before the “@” starts, ends or doubles a dot.",
  syntax_local_charset: "The part before the “@” has characters mail can’t carry.",
  syntax_domain_empty: "Nothing after the “@”.",
  syntax_domain_no_dot: "The domain has no dot — it isn’t a full domain name.",
  syntax_domain_label: "The domain has an invalid section.",
  syntax_domain_too_long: "The domain is too long.",
  syntax_too_long: "The address is longer than mail servers accept.",
  // --- dns ---
  dns_nxdomain: "That domain doesn’t exist.",
  dns_null_mx: "That domain publicly refuses all mail.",
  dns_no_mx_no_addr: "That domain has no mail server.",
  dns_unknown: "We couldn’t reach the domain’s DNS — unconfirmed.",
  dns_ok: "The domain accepts mail.",
  // --- advisory local signals ---
  typo_suspected: "This looks like a typo of a common provider.",
  disposable_domain: "Throwaway / disposable address provider.",
  role_account: "A shared role inbox, not a person.",
  privacy_relay: "A privacy-forwarding alias.",
  // --- provider signals ---
  provider_deliverable: "The mail provider confirms this mailbox accepts mail.",
  provider_undeliverable: "The mail provider says this mailbox won’t accept mail.",
  provider_risky: "The mail provider flagged this address as risky.",
  provider_unknown: "The mail provider couldn’t reach a conclusion.",
  provider_catch_all: "The domain accepts everything, so the mailbox can’t be confirmed.",
  provider_mailbox_not_found: "The mail server reported no such mailbox.",
  provider_disposable: "The mail provider classes this as disposable.",
  provider_role: "The mail provider classes this as a role inbox.",
  // --- chain bookkeeping ---
  local_only: "Free checks only — no mail provider was consulted.",
  provider_quota_exhausted: "Deep-verify quota is used up for this period.",
  provider_not_configured: "No mail-verification provider is configured.",
  provider_error: "The mail-verification provider errored.",
};

/** One sentence for a reason code. Unknown codes degrade to the raw code. */
export function reasonText(code: ReasonCode): string {
  return REASON_TEXT[code] ?? code;
}

/** Every reason as a sentence, in engine order. */
export function reasonTexts(codes: readonly ReasonCode[]): string[] {
  return codes.map(reasonText);
}

/**
 * Reasons worth showing next to a field — drops the "everything is fine" and
 * bookkeeping noise so an inline hint stays one short line.
 */
const QUIET: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "dns_ok",
  "local_only",
  "provider_deliverable",
]);

export function primaryReason(codes: readonly ReasonCode[]): string | null {
  const first = codes.find((c) => !QUIET.has(c));
  return first ? reasonText(first) : null;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  OK: "Looks deliverable",
  WARN: "Worth a look",
  BLOCK: "Won’t deliver",
};

/** Maps our verdict onto the app's semantic status tokens. */
export const VERDICT_TONE: Record<Verdict, "ready" | "notready" | "dropped"> = {
  OK: "ready",
  WARN: "notready",
  BLOCK: "dropped",
};

export const PROVIDER_LABEL: Record<ProviderName, string> = {
  verifalia: "Verifalia",
  reoon: "Reoon",
};

/** Footnote describing who actually answered. */
export function sourceText(provider: ProviderName | null): string {
  return provider ? `Verified by ${PROVIDER_LABEL[provider]}` : "Local checks only";
}
