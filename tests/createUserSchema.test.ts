import { describe, it, expect } from "vitest";
import { createUserSchema } from "@/lib/admin/createUserSchema";

const base = {
  email: "a@b.com",
  username: "validuser",
  fullName: "A",
  displayName: "A",
  tempPassword: "longenough",
  departmentIds: ["550e8400-e29b-41d4-a716-446655440000"],
};

describe("createUserSchema", () => {
  it("rejects short passwords", () => {
    expect(createUserSchema.safeParse({ ...base, tempPassword: "short" }).success).toBe(false);
  });
  it("requires at least one department", () => {
    expect(createUserSchema.safeParse({ ...base, departmentIds: [] }).success).toBe(false);
  });
  it("rejects an invalid email", () => {
    expect(createUserSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });
  it("accepts valid input", () => {
    expect(createUserSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a too-short username", () => {
    expect(createUserSchema.safeParse({ ...base, username: "ab" }).success).toBe(false);
  });

  it("rejects a username with spaces/symbols", () => {
    expect(createUserSchema.safeParse({ ...base, username: "bad name!" }).success).toBe(false);
  });

  it("lowercases the username", () => {
    const r = createUserSchema.safeParse({ ...base, username: "MixedCase" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.username).toBe("mixedcase");
  });
});
