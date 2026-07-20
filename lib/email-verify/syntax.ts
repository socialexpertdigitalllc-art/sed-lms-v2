import type { ReasonCode, SyntaxResult } from "./types";

/**
 * WHATWG-style address parsing (NOT a naive regex).
 *
 * Deliberate rules:
 *  - exactly one "@" (quoted local-parts containing "@" are rejected: we would
 *    rather reject an exotic-but-legal address than accept a typo'd one);
 *  - local-part <= 64 OCTETS, whole address <= 254 OCTETS (RFC 3696 errata 1690);
 *  - the domain must contain at least one dot (a bare hostname is never a real
 *    customer address);
 *  - no leading, trailing or consecutive dots in the local-part;
 *  - the DOMAIN is lowercased, the LOCAL-PART is not — local-parts may be
 *    case-sensitive (RFC 3696 errata 1004 / RFC 5321 §2.4).
 */

/** WHATWG "valid e-mail address" local-part atom characters. */
const LOCAL_CHARS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
/** A single DNS label: alphanumeric, inner hyphens, 1..63 chars. */
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

const MAX_LOCAL_OCTETS = 64;
const MAX_ADDRESS_OCTETS = 254;
const MAX_DOMAIN_OCTETS = 253;

function octets(s: string): number {
  // Buffer is available in every runtime we target (route handlers run on node).
  return typeof Buffer !== "undefined" ? Buffer.byteLength(s, "utf8") : new TextEncoder().encode(s).length;
}

function fail(reasons: ReasonCode[], localPart = "", domain = ""): SyntaxResult {
  return { valid: false, reasons, localPart, domain, normalized: "" };
}

/**
 * Parse and validate an address. Never throws.
 * Trims surrounding whitespace (and a single pair of angle brackets, since
 * pasted values often arrive as `<a@b.com>`), then validates.
 */
export function parseEmail(input: string): SyntaxResult {
  const raw = (input ?? "").trim().replace(/^<(.*)>$/, "$1").trim();
  if (!raw) return fail(["syntax_empty"]);

  const atCount = (raw.match(/@/g) ?? []).length;
  if (atCount !== 1) return fail(["syntax_at_count"]);

  const [localPart, domainRaw] = raw.split("@");
  const domain = domainRaw.toLowerCase();
  const reasons: ReasonCode[] = [];

  // --- local part ---
  if (!localPart) {
    reasons.push("syntax_local_empty");
  } else {
    if (octets(localPart) > MAX_LOCAL_OCTETS) reasons.push("syntax_local_too_long");
    if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) {
      reasons.push("syntax_local_dot");
    }
    if (!LOCAL_CHARS.test(localPart)) reasons.push("syntax_local_charset");
  }

  // --- domain ---
  if (!domain) {
    reasons.push("syntax_domain_empty");
  } else {
    if (octets(domain) > MAX_DOMAIN_OCTETS) reasons.push("syntax_domain_too_long");
    const labels = domain.split(".");
    if (labels.length < 2) reasons.push("syntax_domain_no_dot");
    else if (!labels.every((l) => DOMAIN_LABEL.test(l))) reasons.push("syntax_domain_label");
    // A TLD of digits only (1.2.3.4) is an IP, not a mail domain we accept.
    else if (/^\d+$/.test(labels[labels.length - 1])) reasons.push("syntax_domain_label");
  }

  // --- whole address ---
  if (octets(raw) > MAX_ADDRESS_OCTETS) reasons.push("syntax_too_long");

  if (reasons.length) return fail(reasons, localPart, domain);
  return { valid: true, reasons: [], localPart, domain, normalized: `${localPart}@${domain}` };
}

/** Convenience predicate. */
export function isValidSyntax(input: string): boolean {
  return parseEmail(input).valid;
}

/**
 * Cache key: the address with the domain lowercased. Returns "" if unparseable.
 * NOT lowercasing the local-part is deliberate — see the note above.
 */
export function normalizeEmail(input: string): string {
  return parseEmail(input).normalized;
}
