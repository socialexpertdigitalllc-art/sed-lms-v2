// Cloudflare REST client — Registrar (API beta since 2026-04) + zones + DNS.
// Verified live 2026-10-02 against the company account (account-owned token):
//   GET  /accounts/{a}/registrar/domain-search?q=&limit=   -> { domains: DomainCheck[] }
//   POST /accounts/{a}/registrar/domain-check {domains}     -> { domains: DomainCheck[] } (≤20, authoritative)
//   POST /accounts/{a}/registrar/registrations {domain_name, auto_renew, years}
//        -> 201 workflow (succeeded) | 202 workflow (in_progress) — NON-REFUNDABLE once succeeded
//   GET  /accounts/{a}/registrar/registrations/{d}/registration-status -> workflow
//   GET/PATCH /accounts/{a}/registrar/registrations/{d}    -> registration (auto_renew, expires_at, …)
//   GET  /zones?name=&account.id=, POST /zones, /zones/{z}/dns_records (CRUD)
// The API cannot renew yet, and auto_renew DEFAULTS TO FALSE — every purchase
// here passes auto_renew: true or the client's site dies a year later.
// CLOUDFLARE_REGISTRAR_SANDBOX=1 sends registrar calls to the free sandbox
// (no charges, .com/.net only, and it creates no DNS zone).
// Non-throwing + timeouts, like lib/hostinger/client.ts.

const API = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 30000;

export function cloudflareConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
}

export function registrarSandbox(): boolean {
  return process.env.CLOUDFLARE_REGISTRAR_SANDBOX === "1";
}

const account = () => process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const registrar = () => `/accounts/${encodeURIComponent(account())}/${registrarSandbox() ? "registrar-sandbox" : "registrar"}`;

interface CfError {
  code: number;
  message: string;
}

export interface CfResponse<T> {
  ok: boolean;
  status: number;
  result: T | null;
  errors: CfError[];
  resultInfo: Record<string, unknown> | null;
}

async function cfOnce<T>(
  path: string,
  init: { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; json?: unknown; headers?: Record<string, string> },
): Promise<CfResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN ?? ""}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: { success?: boolean; result?: T; errors?: CfError[]; result_info?: Record<string, unknown> } = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { errors: [{ code: res.status, message: text.slice(0, 200) || `HTTP ${res.status}` }] };
    }
    return {
      ok: res.ok && body.success !== false,
      status: res.status,
      result: (body.result ?? null) as T | null,
      errors: Array.isArray(body.errors) ? body.errors : [],
      resultInfo: body.result_info ?? null,
    };
  } catch (e) {
    return { ok: false, status: 0, result: null, errors: [{ code: 0, message: e instanceof Error ? e.message : "network error" }], resultInfo: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads retry once on a network error; writes never retry — a POST that
 *  timed out may still have been applied (a registration certainly may). */
async function cf<T>(
  path: string,
  init: { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; json?: unknown; headers?: Record<string, string> },
): Promise<CfResponse<T>> {
  const first = await cfOnce<T>(path, init);
  if (first.status !== 0 || init.method !== "GET") return first;
  return cfOnce<T>(path, init);
}

export function cfMessage(r: CfResponse<unknown>): string {
  const e = r.errors[0];
  return e ? `${e.message}${e.code ? ` (${e.code})` : ""}` : `HTTP ${r.status}`;
}

// ---------------------------------------------------------------------------
// registrar

export interface DomainCheck {
  name: string;
  registrable: boolean;
  /** extension_not_supported_via_api | extension_not_supported |
   *  extension_disallows_registration | domain_premium | domain_unavailable */
  reason?: string;
  tier?: "standard" | "premium" | string;
  pricing?: { currency: string; registration_cost: string; renewal_cost: string };
}

/** Suggestions for a phrase or name ("jj remodeling atlanta"). Discovery only —
 *  confirm with checkDomains before buying. */
export async function searchDomains(query: string, limit = 12): Promise<DomainCheck[] | null> {
  const q = encodeURIComponent(query.trim());
  const r = await cf<{ domains?: DomainCheck[] }>(`${registrar()}/domain-search?q=${q}&limit=${Math.min(Math.max(limit, 1), 25)}`, {
    method: "GET",
  });
  return r.ok ? (r.result?.domains ?? []) : null;
}

/** Authoritative, real-time availability + price (≤20 names per call). */
export async function checkDomains(domains: string[]): Promise<DomainCheck[] | null> {
  if (domains.length === 0) return [];
  const r = await cf<{ domains?: DomainCheck[] }>(`${registrar()}/domain-check`, {
    method: "POST",
    json: { domains: domains.slice(0, 20) },
  });
  return r.ok ? (r.result?.domains ?? []) : null;
}

export interface CfRegistration {
  domain_name: string;
  status: string;
  auto_renew: boolean;
  privacy_mode?: string;
  locked?: boolean;
  created_at?: string;
  expires_at?: string | null;
}

export interface RegistrationWorkflow {
  /** pending | in_progress | action_required | blocked | succeeded | failed */
  state: string;
  completed: boolean;
  error?: { code?: string | number; message?: string } | null;
  context?: { domain_name?: string; registration?: CfRegistration } | null;
}

export type RegisterResult =
  | { ok: true; workflow: RegistrationWorkflow }
  | { ok: false; message: string; status: number };

export interface RegistrantContact {
  email: string;
  /** E.164 with a dot: "+1.5555550100" */
  phone: string;
  postal_info: {
    name: string;
    organization?: string;
    address: { street: string; city: string; state: string; postal_code: string; country_code: string };
  };
}

/**
 * Buy a domain — CHARGES the account's default payment method and is
 * non-refundable once the workflow succeeds. auto_renew is forced on (the API
 * can't renew, and its default is off). Without `contacts` the account's
 * default address-book entry is the registrant (the sandbox has none — it
 * needs contacts inline). `Prefer: respond-async` returns at once; the caller
 * polls getRegistrationStatus.
 */
export async function registerDomain(
  domain: string,
  opts: { years?: number; contacts?: { registrant: RegistrantContact } } = {},
): Promise<RegisterResult> {
  const r = await cf<RegistrationWorkflow>(`${registrar()}/registrations`, {
    method: "POST",
    json: {
      domain_name: domain,
      auto_renew: true,
      years: opts.years ?? 1,
      privacy_mode: "redaction",
      ...(opts.contacts ? { contacts: opts.contacts } : {}),
    },
    headers: { Prefer: "respond-async" },
  });
  if (!r.ok || !r.result) return { ok: false, message: cfMessage(r), status: r.status };
  return { ok: true, workflow: r.result };
}

export async function getRegistrationStatus(domain: string): Promise<RegistrationWorkflow | null> {
  const r = await cf<RegistrationWorkflow>(`${registrar()}/registrations/${encodeURIComponent(domain)}/registration-status`, {
    method: "GET",
  });
  return r.ok ? r.result : null;
}

export async function getRegistration(domain: string): Promise<CfRegistration | null> {
  const r = await cf<CfRegistration>(`${registrar()}/registrations/${encodeURIComponent(domain)}`, { method: "GET" });
  return r.ok ? r.result : null;
}

/** Turn auto-renew on/off. A PATCH is itself an async workflow on Cloudflare's
 *  side; the next getRegistration shows the new value once it lands. */
export async function setAutoRenew(domain: string, on: boolean): Promise<{ ok: boolean; message?: string }> {
  const r = await cf<unknown>(`${registrar()}/registrations/${encodeURIComponent(domain)}`, {
    method: "PATCH",
    json: { auto_renew: on },
  });
  return r.ok ? { ok: true } : { ok: false, message: cfMessage(r) };
}

/** Every domain registered on the account (cursor-paginated). */
export async function listRegistrations(): Promise<CfRegistration[] | null> {
  const all: CfRegistration[] = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const qs = `per_page=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await cf<CfRegistration[]>(`${registrar()}/registrations?${qs}`, { method: "GET" });
    if (!r.ok || !Array.isArray(r.result)) return null;
    all.push(...r.result);
    const next = typeof r.resultInfo?.cursor === "string" ? r.resultInfo.cursor : "";
    if (!next || r.result.length === 0) break;
    cursor = next;
  }
  return all;
}

// ---------------------------------------------------------------------------
// zones + DNS

export interface CfZone {
  id: string;
  name: string;
  status: string;
  name_servers?: string[];
}

export async function findZone(domain: string): Promise<CfZone | null | "error"> {
  const r = await cf<CfZone[]>(
    `/zones?name=${encodeURIComponent(domain)}&account.id=${encodeURIComponent(account())}&per_page=5`,
    { method: "GET" },
  );
  if (!r.ok || !Array.isArray(r.result)) return "error";
  return r.result.find((z) => z.name.toLowerCase() === domain.toLowerCase()) ?? null;
}

export async function createZone(domain: string): Promise<{ ok: true; zone: CfZone } | { ok: false; message: string }> {
  const r = await cf<CfZone>(`/zones`, {
    method: "POST",
    json: { name: domain, account: { id: account() }, type: "full" },
  });
  return r.ok && r.result ? { ok: true, zone: r.result } : { ok: false, message: cfMessage(r) };
}

export interface DnsRecord {
  id: string;
  type: string;
  /** Fully qualified, e.g. "example.com" or "www.example.com". */
  name: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
}

export type DnsRecordInput = { type: string; name: string; content: string; proxied?: boolean; ttl?: number; comment?: string };

export async function listDnsRecords(zoneId: string): Promise<DnsRecord[] | null> {
  const all: DnsRecord[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await cf<DnsRecord[]>(`/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=100&page=${page}`, {
      method: "GET",
    });
    if (!r.ok || !Array.isArray(r.result)) return null;
    all.push(...r.result);
    const totalPages = Number(r.resultInfo?.total_pages ?? 1);
    if (page >= totalPages || r.result.length === 0) break;
  }
  return all;
}

export async function createDnsRecord(zoneId: string, rec: DnsRecordInput): Promise<{ ok: boolean; message?: string }> {
  const r = await cf<DnsRecord>(`/zones/${encodeURIComponent(zoneId)}/dns_records`, { method: "POST", json: { ttl: 1, ...rec } });
  return r.ok ? { ok: true } : { ok: false, message: cfMessage(r) };
}

export async function updateDnsRecord(zoneId: string, id: string, rec: DnsRecordInput): Promise<{ ok: boolean; message?: string }> {
  const r = await cf<DnsRecord>(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(id)}`, {
    method: "PUT",
    json: { ttl: 1, ...rec },
  });
  return r.ok ? { ok: true } : { ok: false, message: cfMessage(r) };
}

export async function deleteDnsRecord(zoneId: string, id: string): Promise<{ ok: boolean; message?: string }> {
  const r = await cf<unknown>(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return r.ok ? { ok: true } : { ok: false, message: cfMessage(r) };
}
