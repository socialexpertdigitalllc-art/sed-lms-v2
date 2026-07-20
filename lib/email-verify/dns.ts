import { Resolver } from "dns/promises";
import type { DnsResult, DnsStatus } from "./types";

/**
 * Domain-level mail routability.
 *
 * Only three DNS answers are deterministic enough to BLOCK on:
 *   - NXDOMAIN — the domain does not exist;
 *   - RFC 7505 null MX (a single MX, preference 0, empty/"." exchange) — the
 *     domain explicitly declares it accepts no mail;
 *   - no MX *and* no A/AAAA — nothing to fall back to (RFC 5321 §5.1 implicit MX).
 * SERVFAIL, REFUSED and timeouts map to `unknown` and NEVER block: a resolver
 * hiccup must not cost a real lead.
 */

const DEFAULT_TIMEOUT_MS = 5000;

export type MxRecord = { exchange: string; priority: number };

export type LookupOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "nxdomain" }
  | { kind: "nodata" }
  | { kind: "unknown" };

/** RFC 7505: exactly one MX, preference 0, with a null (root) exchange. */
export function classifyMxRecords(records: MxRecord[]): { hasMx: boolean; nullMx: boolean } {
  const usable = records.filter((r) => {
    const ex = (r.exchange ?? "").trim();
    return ex !== "" && ex !== ".";
  });
  const nullMx = records.length === 1 && usable.length === 0 && (records[0]?.priority ?? -1) === 0;
  return { hasMx: usable.length > 0, nullMx };
}

/** Pure decision table — unit-tested without touching the network. */
export function deriveDnsStatus(input: {
  mx: LookupOutcome<MxRecord[]>;
  addr: LookupOutcome<boolean> | null;
}): { status: DnsStatus; hasMx: boolean; nullMx: boolean; hasAddr: boolean } {
  const { mx, addr } = input;

  if (mx.kind === "nxdomain") return { status: "nxdomain", hasMx: false, nullMx: false, hasAddr: false };
  if (mx.kind === "unknown") return { status: "unknown", hasMx: false, nullMx: false, hasAddr: false };

  if (mx.kind === "ok") {
    const { hasMx, nullMx } = classifyMxRecords(mx.value);
    if (nullMx) return { status: "null_mx", hasMx: false, nullMx: true, hasAddr: false };
    if (hasMx) return { status: "ok", hasMx: true, nullMx: false, hasAddr: false };
    // An empty (or all-null-exchange, non-RFC7505) answer behaves like NODATA.
  }

  // NODATA on MX → implicit MX via A/AAAA.
  if (!addr) return { status: "unknown", hasMx: false, nullMx: false, hasAddr: false };
  if (addr.kind === "nxdomain") return { status: "nxdomain", hasMx: false, nullMx: false, hasAddr: false };
  if (addr.kind === "unknown") return { status: "unknown", hasMx: false, nullMx: false, hasAddr: false };
  if (addr.kind === "ok" && addr.value) return { status: "ok", hasMx: false, nullMx: false, hasAddr: true };
  return { status: "no_mx_no_addr", hasMx: false, nullMx: false, hasAddr: false };
}

function toOutcome(err: unknown): LookupOutcome<never> {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "ENOTFOUND" || code === "NXDOMAIN" || code === "EBADNAME") return { kind: "nxdomain" };
  if (code === "ENODATA") return { kind: "nodata" };
  return { kind: "unknown" }; // ESERVFAIL, ETIMEOUT, EREFUSED, ECONNREFUSED…
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("dns timeout"), { code: "ETIMEOUT" })), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Live DNS lookup. Never throws — every failure becomes a status. */
export async function resolveDomainDns(
  domain: string,
  opts: { timeoutMs?: number } = {}
): Promise<DnsResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const name = (domain ?? "").trim().toLowerCase();
  const checkedAt = new Date().toISOString();
  if (!name) return { domain: name, status: "unknown", hasMx: false, nullMx: false, hasAddr: false, checkedAt };

  const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });

  let mx: LookupOutcome<MxRecord[]>;
  try {
    const records = await withTimeout(resolver.resolveMx(name), timeoutMs);
    mx = { kind: "ok", value: records.map((r) => ({ exchange: r.exchange, priority: r.priority })) };
  } catch (err) {
    mx = toOutcome(err);
  }

  let addr: LookupOutcome<boolean> | null = null;
  const mxShape = mx.kind === "ok" ? classifyMxRecords(mx.value) : null;
  const needsAddr = mx.kind === "nodata" || (mxShape !== null && !mxShape.hasMx && !mxShape.nullMx);
  if (needsAddr) {
    addr = await resolveAddr(resolver, name, timeoutMs);
  }

  const derived = deriveDnsStatus({ mx, addr });
  return { domain: name, ...derived, checkedAt };
}

async function resolveAddr(resolver: Resolver, name: string, timeoutMs: number): Promise<LookupOutcome<boolean>> {
  let v4: LookupOutcome<boolean>;
  try {
    const a = await withTimeout(resolver.resolve4(name), timeoutMs);
    v4 = { kind: "ok", value: a.length > 0 };
  } catch (err) {
    v4 = toOutcome(err) as LookupOutcome<boolean>;
  }
  if (v4.kind === "ok" && v4.value) return v4;

  let v6: LookupOutcome<boolean>;
  try {
    const aaaa = await withTimeout(resolver.resolve6(name), timeoutMs);
    v6 = { kind: "ok", value: aaaa.length > 0 };
  } catch (err) {
    v6 = toOutcome(err) as LookupOutcome<boolean>;
  }
  if (v6.kind === "ok" && v6.value) return v6;

  // Neither answered positively: NXDOMAIN wins, then unknown, then "no address".
  if (v4.kind === "nxdomain" || v6.kind === "nxdomain") return { kind: "nxdomain" };
  if (v4.kind === "unknown" || v6.kind === "unknown") return { kind: "unknown" };
  return { kind: "ok", value: false };
}
