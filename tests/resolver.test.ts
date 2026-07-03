import { describe, it, expect } from "vitest";
import { resolvePermissions } from "@/lib/permissions/types";

describe("resolvePermissions", () => {
  it("unions department permissions", () => {
    const r = resolvePermissions(
      [{ permission_key: "leads.view" }, { permission_key: "leads.edit" }],
      []
    );
    expect(r.has("leads.view")).toBe(true);
    expect(r.has("leads.edit")).toBe(true);
  });

  it("adds user grants on top of dept perms", () => {
    const r = resolvePermissions(
      [{ permission_key: "leads.view" }],
      [{ permission_key: "leads.export", is_granted: true, expires_at: null }]
    );
    expect(r.has("leads.export")).toBe(true);
  });

  it("revokes a dept permission via override", () => {
    const r = resolvePermissions(
      [{ permission_key: "leads.delete" }],
      [{ permission_key: "leads.delete", is_granted: false, expires_at: null }]
    );
    expect(r.has("leads.delete")).toBe(false);
  });

  it("ignores expired overrides", () => {
    const past = new Date("2020-01-01").toISOString();
    const r = resolvePermissions(
      [],
      [{ permission_key: "leads.export", is_granted: true, expires_at: past }],
      new Date("2026-01-01")
    );
    expect(r.has("leads.export")).toBe(false);
  });

  it("honors a non-expired override", () => {
    const future = new Date("2099-01-01").toISOString();
    const r = resolvePermissions(
      [],
      [{ permission_key: "leads.export", is_granted: true, expires_at: future }],
      new Date("2026-01-01")
    );
    expect(r.has("leads.export")).toBe(true);
  });

  it("dedupes union from multiple departments", () => {
    const r = resolvePermissions(
      [{ permission_key: "leads.view" }, { permission_key: "leads.view" }],
      []
    );
    expect([...r].filter((k) => k === "leads.view").length).toBe(1);
  });
});
