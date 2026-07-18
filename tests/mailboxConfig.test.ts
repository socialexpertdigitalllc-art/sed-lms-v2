// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { encryptSecret } from "@/lib/mail/crypto";
import { resolveMailboxRow, buildImapConfig, buildSmtpConfig } from "@/lib/mail/config";
import type { CompanyMailboxRow } from "@/lib/mail/types";

const KEY = randomBytes(32).toString("base64");

function row(overrides: Partial<CompanyMailboxRow> = {}): CompanyMailboxRow {
  return {
    id: "m1", user_id: "u1", email_address: "agent@socialexpertdigitalllc.com",
    display_name: "Agent One", imap_host: null, imap_port: null,
    smtp_host: null, smtp_port: null, encrypted_password: encryptSecret("pw!"),
    status: "verified", last_verified_at: null, last_error: null,
    created_by: "u1", created_at: "2026-07-18T00:00:00Z", ...overrides,
  };
}

describe("mailbox config assembly", () => {
  beforeEach(() => { process.env.MAILBOX_ENC_KEY = KEY; });

  it("resolves a row: decrypts password, applies Hostinger defaults", () => {
    const m = resolveMailboxRow(row());
    expect(m.address).toBe("agent@socialexpertdigitalllc.com");
    expect(m.displayName).toBe("Agent One");
    expect(m.password).toBe("pw!");
    expect(m.imap).toEqual({ host: "imap.hostinger.com", port: 993 });
    expect(m.smtp).toEqual({ host: "smtp.hostinger.com", port: 465 });
  });

  it("keeps per-row host/port overrides when present", () => {
    const m = resolveMailboxRow(row({ imap_host: "imap.titan.email", imap_port: 993, smtp_host: "smtp.titan.email", smtp_port: 587 }));
    expect(m.imap).toEqual({ host: "imap.titan.email", port: 993 });
    expect(m.smtp).toEqual({ host: "smtp.titan.email", port: 587 });
  });

  it("builds an SSL imapflow config from a resolved mailbox", () => {
    const m = resolveMailboxRow(row());
    expect(buildImapConfig(m)).toEqual({
      host: "imap.hostinger.com", port: 993, secure: true,
      auth: { user: "agent@socialexpertdigitalllc.com", pass: "pw!" },
    });
  });

  it("builds an SSL nodemailer transport config from a resolved mailbox", () => {
    const m = resolveMailboxRow(row());
    expect(buildSmtpConfig(m)).toEqual({
      host: "smtp.hostinger.com", port: 465, secure: true,
      auth: { user: "agent@socialexpertdigitalllc.com", pass: "pw!" },
    });
  });
});
