import type { ProviderName } from "./types";

/**
 * Provider registry — the single description of every verification provider we
 * support. It drives BOTH the runtime chain (order, free-tier limits) and the
 * settings UI (which credential fields to render, where the docs live, what to
 * tell the user about privacy).
 *
 * PURE: no I/O, no environment access, no secrets. Adding a provider here does
 * not make it usable — an adapter in `providers/` must exist too.
 */

export interface ProviderCredentialField {
  key: string;
  label: string;
  type: "text" | "password";
  placeholder?: string;
}

export interface ProviderDescriptor {
  key: string;
  label: string;
  fields: ProviderCredentialField[];
  /** Free-tier allowance per `period`. Mirrors PROVIDER_LIMITS. */
  freeLimit: number;
  period: "day" | "month";
  docsUrl: string;
  /** True when the vendor publishes an authoritative remaining-credit endpoint. */
  supportsBalance: boolean;
  /** Short, factual. Shown next to the credential form — no marketing copy. */
  privacyNote: string;
  /** Env vars we accept as a ONE-TIME seed for the DB row (never a fallback). */
  envKeys: Record<string, string>;
}

const verifalia: ProviderDescriptor = {
  key: "verifalia",
  label: "Verifalia",
  fields: [
    { key: "username", label: "Username (browser app key)", type: "text", placeholder: "user@example.com" },
    { key: "password", label: "Password", type: "password" },
  ],
  freeLimit: 25,
  period: "day",
  docsUrl: "https://verifalia.com/developers",
  supportsBalance: true,
  privacyNote:
    "Italy/EU-resident processing with a published DPA. Verifalia does not retain the submitted addresses after a job is deleted, and jobs can be deleted immediately after retrieval.",
  envKeys: { username: "VERIFALIA_USERNAME", password: "VERIFALIA_PASSWORD" },
};

const reoon: ProviderDescriptor = {
  key: "reoon",
  label: "Reoon Email Verifier",
  fields: [{ key: "api_key", label: "API key", type: "password" }],
  freeLimit: 600,
  period: "month",
  docsUrl: "https://www.reoon.com/articles/api-documentation-of-reoon-email-verifier/",
  supportsBalance: true,
  privacyNote:
    "US-operated SaaS. Addresses are sent over HTTPS for real-time SMTP probing; Reoon states it does not sell or share verified lists. No EU-residency guarantee.",
  envKeys: { api_key: "REOON_API_KEY" },
};

const mailrook: ProviderDescriptor = {
  key: "mailrook",
  label: "MailRook",
  fields: [{ key: "api_key", label: "API key", type: "password" }],
  // Their own API docs footer states "5 Free Checks/Day" — the marketing page
  // headline of 100/day is NOT what the developer documentation says, so the
  // documented (pessimistic) number is what the proactive counter uses.
  freeLimit: 5,
  period: "day",
  docsUrl: "https://mailrook.com/docs/api",
  // No credits/balance endpoint is documented — we fall back to our counter.
  supportsBalance: false,
  privacyNote:
    "Data-processing terms not reviewed — check before sending client data. Addresses are sent over HTTPS for SMTP-level probing.",
  envKeys: { api_key: "MAILROOK_API_KEY" },
};

const checkMail: ProviderDescriptor = {
  key: "check_mail",
  label: "Check-Mail.org",
  fields: [{ key: "api_key", label: "API key", type: "password" }],
  // Documented free plan: "up to 1000 requests per month, free forever".
  freeLimit: 1000,
  period: "month",
  docsUrl: "https://docs.check-mail.org/api-and-authentication/",
  // Remaining quota is only exposed as a response HEADER on a real lookup, so
  // reading it would burn a request. No standalone balance endpoint exists.
  supportsBalance: false,
  privacyNote:
    "Data-processing terms not reviewed — check before sending client data. Domain-level checks only; their API also accepts a bare domain instead of a full address.",
  envKeys: { api_key: "CHECK_MAIL_API_KEY" },
};

export const PROVIDER_REGISTRY: ProviderDescriptor[] = [verifalia, reoon, mailrook, checkMail];

/**
 * Default order when nothing has been configured: most accurate first.
 * Verifalia and Reoon both confirm an individual mailbox over SMTP; MailRook
 * does too but on a much smaller free tier; Check-Mail is domain-level only,
 * so it answers last. The user can reorder in the settings UI.
 */
export const RECOMMENDED_ORDER: string[] = ["verifalia", "reoon", "mailrook", "check_mail"];

export function getDescriptor(key: string): ProviderDescriptor | undefined {
  return PROVIDER_REGISTRY.find((p) => p.key === key);
}

export function isKnownProvider(key: string): key is ProviderName {
  return PROVIDER_REGISTRY.some((p) => p.key === key);
}

/** Priority a provider gets when we seed it: its index in RECOMMENDED_ORDER. */
export function recommendedPriority(key: string): number {
  const i = RECOMMENDED_ORDER.indexOf(key);
  return i === -1 ? RECOMMENDED_ORDER.length : i;
}

/** Every required field present and non-blank. */
export function hasCompleteCredentials(
  descriptor: ProviderDescriptor,
  credentials: Record<string, string> | null | undefined
): boolean {
  if (!credentials) return false;
  return descriptor.fields.every((f) => (credentials[f.key] ?? "").trim().length > 0);
}

/**
 * A safe, human-recognisable echo of what is stored — never the secret itself.
 * A `text` field shows verbatim; a `password` field shows only its last 4.
 */
export function maskCredentialHint(
  descriptor: ProviderDescriptor,
  credentials: Record<string, string> | null | undefined
): string | null {
  if (!hasCompleteCredentials(descriptor, credentials)) return null;
  const creds = credentials as Record<string, string>;
  const text = descriptor.fields.find((f) => f.type === "text");
  if (text) return creds[text.key].trim();
  const secret = descriptor.fields.find((f) => f.type === "password");
  if (!secret) return null;
  const v = creds[secret.key].trim();
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
}
