import { describe, it, expect } from "vitest";
import {
  buildBoard,
  filterByView,
  isCustomDomainUrl,
  categorizeTracked,
  type TrackedRow,
} from "@/lib/site-studio/deploy/categorize";

const DA = "dmviral.com";

function tracked(over: Partial<TrackedRow>): TrackedRow {
  return {
    id: "d1",
    lead_id: null,
    run_id: null,
    subdomain: "acmev1",
    url: "https://acmev1.dmviral.com",
    status: "live",
    origin: "builder",
    deployed_at: "2026-08-01T00:00:00Z",
    leads: null,
    ...over,
  };
}

describe("isCustomDomainUrl", () => {
  it("treats staging subdomains as not custom", () => {
    expect(isCustomDomainUrl("https://acmev1.dmviral.com", DA)).toBe(false);
    expect(isCustomDomainUrl("https://dmviral.com", DA)).toBe(false);
  });
  it("treats outside hosts as custom", () => {
    expect(isCustomDomainUrl("https://acmeplumbing.com", DA)).toBe(true);
  });
});

describe("categorizeTracked", () => {
  it("live + lead => ready", () => {
    expect(categorizeTracked(tracked({ lead_id: "l1" }), DA)).toBe("ready");
  });
  it("manual unlinked => manual", () => {
    expect(categorizeTracked(tracked({ origin: "manual" }), DA)).toBe("manual");
  });
  it("custom domain => live regardless of lead", () => {
    expect(categorizeTracked(tracked({ lead_id: "l1", url: "https://acme.com" }), DA)).toBe("live");
  });
  it("taken_down linked row => other", () => {
    expect(categorizeTracked(tracked({ lead_id: "l1", status: "taken_down" }), DA)).toBe("other");
  });
});

describe("buildBoard", () => {
  it("adds untracked hosting subdomains as 'other'", () => {
    const rows = buildBoard([tracked({ lead_id: "l1" })], ["acmev1", "mystery"], [], DA);
    const untracked = rows.find((r) => r.subdomain === "mystery");
    expect(untracked).toMatchObject({ id: null, category: "other", status: "untracked" });
    expect(rows.filter((r) => r.subdomain === "acmev1")).toHaveLength(1); // claimed, not duplicated
  });
  it("keeps taken_down rows attached to their label (no duplicate untracked row)", () => {
    const rows = buildBoard([tracked({ status: "taken_down" })], ["acmev1"], [], DA);
    expect(rows.filter((r) => r.subdomain === "acmev1")).toHaveLength(1);
    expect(rows[0].status).toBe("taken_down");
  });
  it("adds hostinger domains as 'live', excluding the staging apex and claimed transfers", () => {
    const transferred = tracked({ id: "d2", lead_id: "l2", url: "https://acmeplumbing.com" });
    const rows = buildBoard([transferred], [], ["dmviral.com", "acmeplumbing.com", "other.com"], DA);
    expect(rows.find((r) => r.url === "https://dmviral.com")).toBeUndefined();
    expect(rows.filter((r) => r.url.includes("acmeplumbing.com"))).toHaveLength(1);
    expect(rows.find((r) => r.url === "https://other.com")).toMatchObject({ category: "live", id: null });
  });
  it("null hosting lists (fetch failure) degrade to DB rows only", () => {
    const rows = buildBoard([tracked({})], null, null, DA);
    expect(rows).toHaveLength(1);
  });
});

describe("filterByView", () => {
  const board = buildBoard(
    [
      tracked({ id: "a", subdomain: "readyv1", url: "https://readyv1.dmviral.com", lead_id: "l1" }),
      tracked({ id: "b", subdomain: "manv1", url: "https://manv1.dmviral.com", origin: "manual" }),
      tracked({ id: "c", url: "https://custom.com", lead_id: "l2" }),
    ],
    ["readyv1", "manv1", "stray"],
    ["custom.com", "unclaimed.com"],
    DA,
  );
  it("all = subdomain universe (no custom domains)", () => {
    const all = filterByView(board, "all");
    expect(all.every((r) => !r.isCustomDomain)).toBe(true);
    expect(all.map((r) => r.subdomain).sort()).toEqual(["manv1", "readyv1", "stray"]);
  });
  it("ready / manual / other partition the subdomains", () => {
    expect(filterByView(board, "ready").map((r) => r.subdomain)).toEqual(["readyv1"]);
    expect(filterByView(board, "manual").map((r) => r.subdomain)).toEqual(["manv1"]);
    expect(filterByView(board, "other").map((r) => r.subdomain)).toEqual(["stray"]);
  });
  it("live = custom domains incl. unclaimed hosting domains", () => {
    expect(filterByView(board, "live").map((r) => r.url).sort()).toEqual([
      "https://custom.com",
      "https://unclaimed.com",
    ]);
  });
});

describe("buildBoard with hosted-site types", () => {
  it("carries each hosted site's type, onto untracked rows and tracked transfers alike", () => {
    const transferred = tracked({ id: "d2", lead_id: "l2", url: "https://acmeplumbing.com" });
    const rows = buildBoard(
      [transferred],
      [],
      [
        { domain: "acmeplumbing.com", siteType: "other" },
        { domain: "wpclient.com", siteType: "wordpress" },
      ],
      DA,
    );
    expect(rows.find((r) => r.id === "d2")).toMatchObject({ siteType: "other", category: "live" });
    expect(rows.find((r) => r.url === "https://wpclient.com")).toMatchObject({ siteType: "wordpress", id: null });
    expect(rows.filter((r) => r.url.includes("acmeplumbing.com"))).toHaveLength(1);
  });

  it("staging rows have no site type", () => {
    const rows = buildBoard([tracked({ lead_id: "l1" })], ["acmev1"], null, DA);
    expect(rows.every((r) => r.siteType === null)).toBe(true);
  });
});
