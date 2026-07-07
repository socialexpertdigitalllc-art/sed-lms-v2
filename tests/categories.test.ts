import { describe, it, expect } from "vitest";
import {
  statusSlug,
  catViewKey,
  catSetKey,
  visibleStatuses,
  settableStatuses,
} from "@/lib/leads/categories";

describe("category permission helpers", () => {
  it("slugs statuses (lowercase, spaces to underscores)", () => {
    expect(statusSlug("Ready")).toBe("ready");
    expect(statusSlug("Not Ready")).toBe("not_ready");
    expect(statusSlug("Long Term")).toBe("long_term");
  });

  it("builds permission keys", () => {
    expect(catViewKey("Not Ready")).toBe("leads.cat_view.not_ready");
    expect(catSetKey("Long Term")).toBe("leads.cat_set.long_term");
  });

  it("filters visible statuses by cat_view keys, in canonical order, ignoring unknown keys", () => {
    const perms = new Set([
      "leads.cat_view.long_term",
      "leads.cat_view.ready",
      "leads.cat_view.bogus",
    ]);
    expect(visibleStatuses(perms)).toEqual(["Ready", "Long Term"]);
  });

  it("filters settable statuses by cat_set keys", () => {
    const perms = new Set(["leads.cat_set.closed"]);
    expect(settableStatuses(perms)).toEqual(["Closed"]);
    expect(settableStatuses(new Set())).toEqual([]);
  });
});
