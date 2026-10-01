import { describe, it, expect } from "vitest";
import { matchSubscriptions, renewalFacts, subscriptionNameFor } from "@/lib/domains/subscriptions";
import type { HostingerSubscription } from "@/lib/hostinger/client";

/**
 * A Hostinger domain subscription never names its domain ("…COM Domain"), so
 * auto-renew and renewing are only possible once each is tied to its domain.
 * The tie is the domain's expiry, to the second (measured live on all 107
 * domains). A wrong tie would renew — or stop renewing — the wrong client's
 * domain, so anything less than an exact one-to-one match stays unmatched.
 */

let n = 0;
const sub = (over: Partial<HostingerSubscription>): HostingerSubscription => ({
  id: `s${++n}`,
  name: ".COM Domain",
  status: "active",
  is_auto_renewed: true,
  renewal_price: 2019,
  total_price: 2019,
  currency_code: "USD",
  created_at: "2025-12-15T22:00:00Z",
  expires_at: null,
  next_billing_at: null,
  ...over,
});

describe("subscriptionNameFor", () => {
  it("names the extension the way Hostinger does", () => {
    expect(subscriptionNameFor("acme.com")).toBe(".COM Domain");
    expect(subscriptionNameFor("Acme.Online")).toBe(".ONLINE Domain");
    expect(subscriptionNameFor("acme.co.uk")).toBe(".CO.UK Domain");
  });
});

describe("matchSubscriptions", () => {
  const domain = { domain: "acme.com", expires_at: "2027-08-25T18:08:12Z" };

  it("a renewing subscription bills 27 days ahead, at the same second", () => {
    const s = sub({ next_billing_at: "2027-07-29T18:08:12Z" });
    expect(matchSubscriptions([domain], [s]).get("acme.com")).toBe(s);
  });

  it("a non-renewing or cancelled one carries the expiry itself", () => {
    const s = sub({ status: "non_renewing", is_auto_renewed: false, expires_at: "2027-08-25T18:08:12Z" });
    expect(matchSubscriptions([domain], [s]).get("acme.com")).toBe(s);
  });

  it("the extension must match", () => {
    expect(matchSubscriptions([domain], [sub({ name: ".NET Domain", next_billing_at: "2027-07-29T18:08:12Z" })]).size).toBe(0);
  });

  it("a different second, or more than 60 days ahead, is not a match", () => {
    expect(matchSubscriptions([domain], [sub({ next_billing_at: "2027-07-29T18:08:19Z" })]).size).toBe(0);
    expect(matchSubscriptions([domain], [sub({ next_billing_at: "2027-06-01T18:08:12Z" })]).size).toBe(0);
    expect(matchSubscriptions([domain], [sub({ next_billing_at: "2027-08-26T18:08:12Z" })]).size).toBe(0);
  });

  it("ambiguity either way leaves both unmatched", () => {
    // two subscriptions fit one domain
    expect(matchSubscriptions([domain], [sub({ next_billing_at: "2027-07-29T18:08:12Z" }), sub({ expires_at: "2027-08-25T18:08:12Z" })]).size).toBe(0);
    // one subscription fits two domains
    const twin = { domain: "twin.com", expires_at: "2027-08-25T18:08:12Z" };
    expect(matchSubscriptions([domain, twin], [sub({ next_billing_at: "2027-07-29T18:08:12Z" })]).size).toBe(0);
  });

  it("a domain without an expiry date (a plan's free domain) is never matched", () => {
    expect(matchSubscriptions([{ domain: "free.com", expires_at: null }], [sub({ next_billing_at: "2027-07-29T18:08:12Z" })]).size).toBe(0);
  });
});

describe("renewalFacts", () => {
  it("an active, auto-renewing subscription: renews, with the next charge", () => {
    expect(renewalFacts(sub({ next_billing_at: "2027-07-29T18:08:12Z" }))).toMatchObject({
      autoRenew: true,
      renewalCents: 2019,
      currency: "USD",
      nextBillingAt: "2027-07-29T18:08:12Z",
      subscriptionStatus: "active",
    });
  });

  it("non-renewing or cancelled: won't renew, no charge coming", () => {
    expect(renewalFacts(sub({ status: "non_renewing", is_auto_renewed: false }))).toMatchObject({ autoRenew: false, nextBillingAt: null });
    expect(renewalFacts(sub({ status: "cancelled", is_auto_renewed: false }))).toMatchObject({ autoRenew: false, nextBillingAt: null });
  });

  it("no matched subscription: everything unknown", () => {
    expect(renewalFacts(undefined)).toEqual({
      autoRenew: null,
      renewalCents: null,
      currency: null,
      nextBillingAt: null,
      subscriptionId: null,
      subscriptionStatus: null,
    });
  });
});
