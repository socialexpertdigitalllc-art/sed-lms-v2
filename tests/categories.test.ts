import { describe, it, expect } from "vitest";
import {
  statusSlug,
  catViewKey,
  catSetKey,
  visibleStatuses,
  settableStatuses,
  statusSetError,
} from "@/lib/leads/categories";

describe("statusSetError (server-side status gate)", () => {
  const salesPerms = new Set([
    "leads.status_change",
    "leads.cat_set.ready",
    "leads.cat_set.not_ready",
    "leads.cat_view.closed", // can SEE closed — must not imply can SET
  ]);

  it("allows a status the user holds cat_set for", () => {
    expect(statusSetError(salesPerms, "Ready")).toBeNull();
    expect(statusSetError(salesPerms, "Not Ready")).toBeNull();
  });

  it("rejects a status the user can only view (the bulk-bypass bug)", () => {
    expect(statusSetError(salesPerms, "Closed")).toMatch(/not allowed/);
  });

  it("rejects unknown statuses outright", () => {
    expect(statusSetError(salesPerms, "Banana")).toMatch(/Unknown status/);
  });
});

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
