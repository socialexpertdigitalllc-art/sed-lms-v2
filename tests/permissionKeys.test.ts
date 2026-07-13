import { describe, it, expect } from "vitest";
import { PERMISSIONS, isKnownPermissionKey } from "@/lib/permissions/constants";

describe("isKnownPermissionKey", () => {
  it("accepts every catalog key", () => {
    for (const p of PERMISSIONS) expect(isKnownPermissionKey(p.key)).toBe(true);
  });

  it("accepts the per-category lead keys seeded by migration 0011", () => {
    expect(isKnownPermissionKey("leads.cat_view.ready")).toBe(true);
    expect(isKnownPermissionKey("leads.cat_view.not_ready")).toBe(true);
    expect(isKnownPermissionKey("leads.cat_set.long_term")).toBe(true);
    expect(isKnownPermissionKey("leads.cat_set.dropped")).toBe(true);
  });

  it("includes leads.followup (migration 0013) in the catalog", () => {
    expect(isKnownPermissionKey("leads.followup")).toBe(true);
    expect(PERMISSIONS.some((p) => p.key === "leads.followup")).toBe(true);
  });

  it("rejects unknown, malformed, and non-string keys", () => {
    expect(isKnownPermissionKey("leads.hack_everything")).toBe(false);
    expect(isKnownPermissionKey("leads.cat_set.nonexistent_status")).toBe(false);
    expect(isKnownPermissionKey("")).toBe(false);
    expect(isKnownPermissionKey(undefined)).toBe(false);
    expect(isKnownPermissionKey(null)).toBe(false);
    expect(isKnownPermissionKey(42)).toBe(false);
  });
});
