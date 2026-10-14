import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetching a web address SOMEONE ELSE chose (a profile link the model passed,
 * a listing pasted into the chat) without letting it reach inside our own
 * network: only public http(s) addresses on the standard ports, every
 * redirect re-checked, and the host's DNS answers checked too — so
 * "http://localhost:3000/api/…", "http://169.254.169.254/" or a public name
 * that resolves to a private address are refused. SERVER ONLY.
 */

export class UnsafeUrlError extends Error {}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::" || s === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return privateV4(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(s);
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateV4(ip);
  if (kind === 6) return privateV6(ip);
  return true;
}

/** Throws UnsafeUrlError unless the address is a public http(s) URL whose host resolves only to public addresses. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only web addresses can be opened.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new UnsafeUrlError("That address uses an unusual port.");
  if (url.username || url.password) throw new UnsafeUrlError("Addresses with sign-in details are not opened.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || (!host.includes(".") && !isIP(host))) {
    throw new UnsafeUrlError("That address is not a public website.");
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("That address is not a public website.");
    return url;
  }
  const answers = await lookup(host, { all: true, verbatim: true }).catch(() => []);
  // Not found is not unsafe — just unreachable (callers say nothing about it).
  if (!answers.length) throw new Error("That website could not be found.");
  if (answers.some((a) => isPrivateAddress(a.address))) throw new UnsafeUrlError("That address is not a public website.");
  return url;
}

/** fetch() for someone else's address: every hop checked, at most `maxRedirects` redirects. */
export async function safeFetch(raw: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      current = new URL(location, url).toString();
      continue;
    }
    // The final address, for callers that read where a short link led.
    Object.defineProperty(res, "url", { value: url.toString() });
    return res;
  }
  throw new UnsafeUrlError("Too many redirects.");
}
