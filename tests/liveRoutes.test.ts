import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "fs";
import path from "path";
import { liveRouteFor, LIVE_ROUTES } from "@/lib/realtime/liveRoutes";

/**
 * "Everything live, leave nothing behind": every page of the app must have a
 * rule — a list of the tables it shows, or `self` (it keeps itself live), or
 * an explicit empty list for an on-demand tool. A new page without one fails
 * here, so it can't silently be left on reload-to-see-changes.
 */
const APP = path.resolve(__dirname, "../app/(app)");

function pages(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      const seg = name.startsWith("(") ? "" : `/${name.replace(/^\[.*\]$/, "x123")}`;
      out.push(...pages(full, prefix + seg));
    } else if (name === "page.tsx") {
      out.push(prefix || "/");
    }
  }
  return out;
}

describe("live routes — every screen is covered", () => {
  const all = pages(APP);

  it("finds the app's pages", () => {
    expect(all.length).toBeGreaterThan(50);
    expect(all).toContain("/leads");
    expect(all).toContain("/leads/x123");
  });

  it.each(all)("%s has a live rule", (p) => {
    expect(liveRouteFor(p), `no live rule for ${p} — add it to lib/realtime/liveRoutes.ts`).not.toBeNull();
  });

  it("every listed table name is a plain identifier", () => {
    for (const r of LIVE_ROUTES) for (const t of r.tables ?? []) expect(t).toMatch(/^[a-z_]+$/);
  });
});

describe("live routes — which rule a path gets", () => {
  it("specific paths win over the lead page pattern", () => {
    expect(liveRouteFor("/leads/follow-ups")?.route.tables).toEqual(["profiles"]);
    expect(liveRouteFor("/leads/new")?.route.tables).toContain("website_addons");
    expect(liveRouteFor("/leads/abc")?.route.self).toBe(true);
    expect(liveRouteFor("/leads/abc/tickets")?.route.tables).toContain("ticket_items");
  });

  it("a ticket page refreshes only for its own ticket and items", () => {
    const f = liveRouteFor("/tickets/T1")!;
    const m = (p: Record<string, string>) => f.route.match!(p as never, f.params);
    expect(m({ table: "lead_tickets", id: "T1" })).toBe(true);
    expect(m({ table: "lead_tickets", id: "T2" })).toBe(false);
    expect(m({ table: "ticket_items", ticket_id: "T1" })).toBe(true);
    expect(m({ table: "ticket_items", ticket_id: "T2" })).toBe(false);
  });

  it("a lead's tickets page ignores other leads' tickets", () => {
    const f = liveRouteFor("/leads/L1/tickets")!;
    const m = (p: Record<string, string>) => f.route.match!(p as never, f.params);
    expect(m({ table: "lead_tickets", lead_id: "L1" })).toBe(true);
    expect(m({ table: "lead_tickets", lead_id: "L2" })).toBe(false);
  });

  it("detail pages match their own id", () => {
    const f = liveRouteFor("/pre-leads/P1")!;
    expect(f.route.match!({ table: "pre_leads", id: "P1" }, f.params)).toBe(true);
    expect(f.route.match!({ table: "pre_leads", id: "P2" }, f.params)).toBe(false);
    expect(liveRouteFor("/pre-leads/new")?.route.tables).toEqual([]);
    expect(liveRouteFor("/pre-leads/all")?.route.tables).toContain("pre_leads");
  });

  it("busy tables are slowed down", () => {
    expect(liveRouteFor("/admin/logs")?.route.minGapMs).toBeGreaterThanOrEqual(10_000);
    expect(liveRouteFor("/domains/analytics")?.route.minGapMs).toBeGreaterThanOrEqual(30_000);
  });

  it("an unknown path has no rule", () => {
    expect(liveRouteFor("/nowhere")).toBeNull();
  });
});
