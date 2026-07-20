import { isRequiredMailbox } from "./lists";
import type { ReasonCode, VerdictResult, VerdictSignals } from "./types";

/**
 * Combine every signal into OUR enum.
 *
 * The one rule that matters: **BLOCK is reserved for deterministic failures** —
 * a malformed address, NXDOMAIN, an RFC 7505 null MX, or no MX *and* no
 * A/AAAA. Anything probabilistic (catch-all, unknown, role, disposable, a
 * provider saying "mailbox does not exist" over SMTP, a DNS timeout) is a WARN.
 * A false BLOCK loses a real lead; a WARN only asks a human to look.
 */
export function computeVerdict(signals: VerdictSignals): VerdictResult {
  const reasons: ReasonCode[] = [];

  // --- 1. deterministic: syntax ---
  if (!signals.syntax.valid) {
    return { verdict: "BLOCK", reasons: dedupe(signals.syntax.reasons) };
  }

  // --- 2. deterministic: DNS ---
  const dns = signals.dns ?? "unknown";
  if (dns === "nxdomain") return { verdict: "BLOCK", reasons: ["dns_nxdomain"] };
  if (dns === "null_mx") return { verdict: "BLOCK", reasons: ["dns_null_mx"] };
  if (dns === "no_mx_no_addr") return { verdict: "BLOCK", reasons: ["dns_no_mx_no_addr"] };

  // Past this point nothing can BLOCK.
  let warn = false;

  if (dns === "unknown") {
    // SERVFAIL / timeout / not checked — we do not know, so we do not block.
    reasons.push("dns_unknown");
    warn = true;
  } else {
    reasons.push("dns_ok");
  }

  // --- 3. advisory local signals ---
  if (signals.privacyRelay) {
    // A forwarding alias resolves to a real mailbox: informational, not a warning.
    reasons.push("privacy_relay");
  } else if (signals.disposable) {
    reasons.push("disposable_domain");
    warn = true;
  }

  if (signals.role) {
    reasons.push("role_account");
    warn = true;
  }

  if (signals.suggestion) {
    reasons.push("typo_suspected");
    warn = true;
  }

  // --- 4. provider signal (already mapped out of the vendor's vocabulary) ---
  const p = signals.provider;
  if (p) {
    switch (p.classification) {
      case "deliverable":
        reasons.push("provider_deliverable");
        break;
      case "undeliverable":
        reasons.push("provider_undeliverable");
        warn = true;
        break;
      case "risky":
        reasons.push("provider_risky");
        warn = true;
        break;
      case "unknown":
        reasons.push("provider_unknown");
        warn = true;
        break;
    }
    if (p.detail === "catch_all") reasons.push("provider_catch_all");
    if (p.detail === "mailbox_not_found") reasons.push("provider_mailbox_not_found");
    if (p.detail === "disposable") reasons.push("provider_disposable");
    if (p.detail === "role") reasons.push("provider_role");
  }

  if (signals.localOnly) reasons.push("local_only");

  // RFC 5321 §4.5.1: every mail-accepting domain must accept postmaster@.
  // Its DNS is fine (we got here), so a provider's negative SMTP probe is not
  // evidence the address is bad — never let it read as anything worse than a warning.
  if (isRequiredMailbox(signals.localPart ?? "") && dns !== "unknown" && !signals.suggestion) {
    const onlyProviderDoubt = reasons.every(
      (r) =>
        r === "dns_ok" ||
        r === "role_account" ||
        r === "local_only" ||
        r === "privacy_relay" ||
        r.startsWith("provider_")
    );
    if (onlyProviderDoubt) return { verdict: "OK", reasons: dedupe(reasons) };
  }

  return { verdict: warn ? "WARN" : "OK", reasons: dedupe(reasons) };
}

function dedupe(reasons: ReasonCode[]): ReasonCode[] {
  return Array.from(new Set(reasons));
}
