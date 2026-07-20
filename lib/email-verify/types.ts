/**
 * Email verification — shared types.
 *
 * Verdict is OUR OWN enum. A provider's vocabulary (Verifalia's
 * "Undeliverable", Reoon's "catch_all", …) must never reach the UI: every
 * adapter maps into `ProviderClassification` and the verdict engine turns
 * that, plus the local signals, into BLOCK | WARN | OK.
 */

/** The only three values the UI ever sees. */
export type Verdict = "BLOCK" | "WARN" | "OK";

/** Stable machine codes explaining a verdict. Never localise these — the UI maps them. */
export type ReasonCode =
  // --- syntax (deterministic) ---
  | "syntax_empty"
  | "syntax_at_count"
  | "syntax_local_empty"
  | "syntax_local_too_long"
  | "syntax_local_dot"
  | "syntax_local_charset"
  | "syntax_domain_empty"
  | "syntax_domain_no_dot"
  | "syntax_domain_label"
  | "syntax_domain_too_long"
  | "syntax_too_long"
  // --- dns (deterministic when it fails hard) ---
  | "dns_nxdomain"
  | "dns_null_mx"
  | "dns_no_mx_no_addr"
  | "dns_unknown"
  | "dns_ok"
  // --- advisory local signals ---
  | "typo_suspected"
  | "disposable_domain"
  | "role_account"
  | "privacy_relay"
  // --- provider signals ---
  | "provider_deliverable"
  | "provider_undeliverable"
  | "provider_risky"
  | "provider_unknown"
  | "provider_catch_all"
  | "provider_mailbox_not_found"
  | "provider_disposable"
  | "provider_role"
  // --- chain bookkeeping ---
  | "local_only"
  | "provider_quota_exhausted"
  | "provider_not_configured"
  | "provider_error";

/** Normalised provider outcome. Every adapter must map into one of these. */
export type ProviderClassification = "deliverable" | "undeliverable" | "risky" | "unknown";

/** Extra detail a provider may add on top of the classification. */
export type ProviderDetail = "catch_all" | "mailbox_not_found" | "disposable" | "role" | null;

export type ProviderName = "verifalia" | "reoon";

/** Result of the syntax parse. `normalized` lowercases the DOMAIN ONLY. */
export type SyntaxResult = {
  valid: boolean;
  reasons: ReasonCode[];
  /** Local-part exactly as supplied (case preserved — RFC 3696 errata 1004). */
  localPart: string;
  /** Lowercased domain. */
  domain: string;
  /** `localPart@domain`, or "" when unparseable. */
  normalized: string;
};

export type DnsStatus =
  /** MX present (or implicit MX via A/AAAA) — mail can be routed. */
  | "ok"
  /** Domain does not exist. Deterministic. */
  | "nxdomain"
  /** RFC 7505 null MX — the domain explicitly accepts no mail. Deterministic. */
  | "null_mx"
  /** No MX and no A/AAAA. Deterministic. */
  | "no_mx_no_addr"
  /** SERVFAIL, timeout, refused… — we simply do not know. NEVER blocks. */
  | "unknown";

export type DnsResult = {
  domain: string;
  status: DnsStatus;
  hasMx: boolean;
  nullMx: boolean;
  hasAddr: boolean;
  checkedAt: string;
};

/** Everything we can determine for free, without calling a paid provider. */
export type LocalResult = {
  input: string;
  normalized: string;
  localPart: string;
  domain: string;
  syntax: SyntaxResult;
  /** Full suggested address (never auto-applied), e.g. "a@gmail.com". */
  suggestion: string | null;
  disposable: boolean;
  role: boolean;
  privacyRelay: boolean;
  freeProvider: boolean;
  dns: DnsResult | null;
};

/** Common provider adapter return shape. */
export type RemoteResult =
  | {
      ok: true;
      /** The provider's OWN status string, kept verbatim for audit. */
      status: string;
      /** Our normalised mapping of that status. */
      classification: ProviderClassification;
      detail: ProviderDetail;
      raw: unknown;
    }
  | { ok: false; reason: "quota" | "auth" | "error"; message: string };

export type ProviderSignal = {
  provider: ProviderName;
  status: string;
  classification: ProviderClassification;
  detail: ProviderDetail;
};

/** Signals fed to the verdict engine. Everything optional except syntax. */
export type VerdictSignals = {
  syntax: Pick<SyntaxResult, "valid" | "reasons">;
  localPart?: string;
  dns?: DnsStatus | null;
  disposable?: boolean;
  role?: boolean;
  privacyRelay?: boolean;
  suggestion?: string | null;
  provider?: ProviderSignal | null;
  /** Set when no provider answered, so the UI can label the result local-only. */
  localOnly?: boolean;
};

export type VerdictResult = { verdict: Verdict; reasons: ReasonCode[] };

/** The full answer returned by the engine / API route. */
export type VerificationResult = {
  email: string;
  normalized: string;
  domain: string;
  verdict: Verdict;
  reasons: ReasonCode[];
  suggestion: string | null;
  local: LocalResult;
  provider: ProviderName | null;
  providerStatus: string | null;
  /** true when no remote provider contributed (local signals only). */
  localOnly: boolean;
  cached: boolean;
  verifiedAt: string;
};
