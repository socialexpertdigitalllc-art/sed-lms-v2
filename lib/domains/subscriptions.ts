// lib/domains/subscriptions.ts — which Hostinger billing subscription is which
// domain. A domain subscription never names its domain (it is just ".COM
// Domain"), but its timestamps carry the domain's expiry TO THE SECOND
// (verified 2026-10-02 on all 107 portfolio domains with an expiry, 0
// ambiguous):
//   - a renewing subscription bills ahead of expiry: next_billing_at is the
//     expiry minus a whole number of days (27 today) at the same second;
//   - a non-renewing / cancelled one carries the expiry itself in expires_at.
// So: same extension, same time of day to the second, expiry 0–60 whole days
// after the subscription's date. A match must be one-to-one both ways; anything
// ambiguous is left unmatched (auto-renew then shows as unknown, never wrong).
import type { HostingerSubscription } from "@/lib/hostinger/client";

const DAY_MS = 86_400_000;
const TOLERANCE_MS = 2_000;
const MAX_LEAD_DAYS = 60;

/** ".COM Domain" for example.com, ".CO.UK Domain" for example.co.uk. */
export function subscriptionNameFor(domain: string): string {
  return `.${domain.toLowerCase().split(".").slice(1).join(".").toUpperCase()} Domain`;
}

/** Does `stamp` sit 0–60 whole days before `expiresAt`, at the same second of the day? */
function sameSecondBefore(expiresAt: number, stamp: string | null): boolean {
  if (!stamp) return false;
  const diff = expiresAt - Date.parse(stamp);
  if (Number.isNaN(diff) || diff < -TOLERANCE_MS || diff > MAX_LEAD_DAYS * DAY_MS + TOLERANCE_MS) return false;
  const rem = ((diff % DAY_MS) + DAY_MS) % DAY_MS;
  return rem <= TOLERANCE_MS || rem >= DAY_MS - TOLERANCE_MS;
}

/** Pure: domain (lowercase) → its subscription, for the unambiguous matches. Tested. */
export function matchSubscriptions(
  domains: { domain: string; expires_at: string | null }[],
  subscriptions: HostingerSubscription[],
): Map<string, HostingerSubscription> {
  const candidates = new Map<string, Set<HostingerSubscription>>();
  const claimedBy = new Map<string, Set<string>>();
  for (const d of domains) {
    const exp = d.expires_at ? Date.parse(d.expires_at) : NaN;
    if (Number.isNaN(exp)) continue;
    const name = d.domain.toLowerCase();
    const want = subscriptionNameFor(name);
    for (const s of subscriptions) {
      if (s.name !== want) continue;
      if (!sameSecondBefore(exp, s.next_billing_at) && !sameSecondBefore(exp, s.expires_at)) continue;
      if (!candidates.has(name)) candidates.set(name, new Set());
      candidates.get(name)!.add(s);
      if (!claimedBy.has(s.id)) claimedBy.set(s.id, new Set());
      claimedBy.get(s.id)!.add(name);
    }
  }
  const out = new Map<string, HostingerSubscription>();
  for (const [name, subs] of candidates) {
    if (subs.size !== 1) continue;
    const [s] = [...subs];
    if (claimedBy.get(s.id)?.size === 1) out.set(name, s);
  }
  return out;
}

/** What a matched subscription says about renewing. */
export function renewalFacts(s: HostingerSubscription | undefined): {
  autoRenew: boolean | null;
  renewalCents: number | null;
  currency: string | null;
  nextBillingAt: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
} {
  if (!s) return { autoRenew: null, renewalCents: null, currency: null, nextBillingAt: null, subscriptionId: null, subscriptionStatus: null };
  return {
    autoRenew: s.status === "active" ? Boolean(s.is_auto_renewed) : false,
    renewalCents: typeof s.renewal_price === "number" ? s.renewal_price : null,
    currency: s.currency_code ?? null,
    nextBillingAt: s.status === "active" && s.is_auto_renewed ? s.next_billing_at : null,
    subscriptionId: s.id,
    subscriptionStatus: s.status,
  };
}
