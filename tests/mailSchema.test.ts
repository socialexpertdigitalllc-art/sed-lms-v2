import { describe, it, expect } from "vitest";
import { linkMailboxSchema } from "@/lib/mail/schema";

const base = {
  user_id: "11111111-1111-4111-8111-111111111111",
  email_address: "agent@socialexpertdigitalllc.com",
  display_name: "Agent One",
  password: "s3cret",
};

describe("linkMailboxSchema", () => {
  it("accepts a minimal valid link (host/port optional)", () => {
    expect(linkMailboxSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a non-email address and empty password", () => {
    expect(linkMailboxSchema.safeParse({ ...base, email_address: "nope" }).success).toBe(false);
    expect(linkMailboxSchema.safeParse({ ...base, password: "" }).success).toBe(false);
  });
  it("rejects a bad user_id and non-positive port", () => {
    expect(linkMailboxSchema.safeParse({ ...base, user_id: "x" }).success).toBe(false);
    expect(linkMailboxSchema.safeParse({ ...base, imap_port: 0 }).success).toBe(false);
  });
  it("accepts advanced host/port overrides", () => {
    expect(linkMailboxSchema.safeParse({ ...base, imap_host: "imap.titan.email", imap_port: 993, smtp_host: "smtp.titan.email", smtp_port: 587 }).success).toBe(true);
  });
});
