// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  classifyVerifaliaHttp,
  extractVerifaliaEntry,
  getVerifaliaCredentials,
  mapVerifaliaEntry,
  verifalia,
} from "@/lib/email-verify/providers/verifalia";
import {
  classifyReoonError,
  classifyReoonHttp,
  getReoonKey,
  mapReoonStatus,
  reoon,
} from "@/lib/email-verify/providers/reoon";

const ENV_KEYS = ["VERIFALIA_USERNAME", "VERIFALIA_PASSWORD", "REOON_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("verifalia adapter", () => {
  it("maps classifications into OUR enum", () => {
    expect(mapVerifaliaEntry({ classification: "Deliverable", status: "Success" }).classification).toBe("deliverable");
    expect(mapVerifaliaEntry({ classification: "Undeliverable", status: "MailboxDoesNotExist" }).classification).toBe(
      "undeliverable"
    );
    expect(mapVerifaliaEntry({ classification: "Risky", status: "ServerIsCatchAll" }).classification).toBe("risky");
    expect(mapVerifaliaEntry({ classification: "Unknown", status: "ServerIsUnreachable" }).classification).toBe(
      "unknown"
    );
    // anything unrecognised degrades to unknown rather than leaking through
    expect(mapVerifaliaEntry({ classification: "SomethingNew", status: "?" }).classification).toBe("unknown");
    expect(mapVerifaliaEntry({}).classification).toBe("unknown");
  });

  it("extracts the detail from the status and flags", () => {
    expect(mapVerifaliaEntry({ classification: "Risky", status: "ServerIsCatchAll" }).detail).toBe("catch_all");
    expect(mapVerifaliaEntry({ classification: "Undeliverable", status: "MailboxDoesNotExist" }).detail).toBe(
      "mailbox_not_found"
    );
    expect(mapVerifaliaEntry({ classification: "Risky", status: "MailboxIsDea" }).detail).toBe("disposable");
    expect(mapVerifaliaEntry({ classification: "Deliverable", status: "Success", isRoleAccount: true }).detail).toBe(
      "role"
    );
    expect(mapVerifaliaEntry({ classification: "Deliverable", status: "Success" }).detail).toBeNull();
  });

  it("keeps the vendor status string verbatim for the audit trail", () => {
    expect(mapVerifaliaEntry({ classification: "Deliverable", status: "Success" }).status).toBe("Success");
  });

  it("classifies HTTP statuses", () => {
    expect(classifyVerifaliaHttp(200)).toBeNull();
    expect(classifyVerifaliaHttp(202)).toBeNull();
    expect(classifyVerifaliaHttp(401)).toBe("auth");
    expect(classifyVerifaliaHttp(403)).toBe("auth");
    expect(classifyVerifaliaHttp(402)).toBe("quota"); // out of credit / over the cap
    expect(classifyVerifaliaHttp(429)).toBe("error");
    expect(classifyVerifaliaHttp(500)).toBe("error");
  });

  it("reads entries from both the paginated and bare shapes", () => {
    expect(extractVerifaliaEntry({ entries: { data: [{ status: "Success" }] } })?.status).toBe("Success");
    expect(extractVerifaliaEntry({ entries: [{ status: "Success" }] })?.status).toBe("Success");
    expect(extractVerifaliaEntry({ entries: { data: [] } })).toBeNull();
    expect(extractVerifaliaEntry(null)).toBeNull();
    expect(extractVerifaliaEntry({})).toBeNull();
  });

  it("treats a missing or blank credential as 'skip me', never an exception", async () => {
    delete process.env.VERIFALIA_USERNAME;
    delete process.env.VERIFALIA_PASSWORD;
    expect(getVerifaliaCredentials()).toBeNull();
    expect(verifalia.isConfigured()).toBe(false);
    await expect(verifalia.verify("a@b.com")).resolves.toEqual({
      ok: false,
      reason: "auth",
      message: expect.any(String),
    });

    process.env.VERIFALIA_USERNAME = "   ";
    process.env.VERIFALIA_PASSWORD = "   ";
    expect(getVerifaliaCredentials()).toBeNull();
    expect(verifalia.isConfigured()).toBe(false);

    process.env.VERIFALIA_USERNAME = "u";
    process.env.VERIFALIA_PASSWORD = "p";
    expect(verifalia.isConfigured()).toBe(true);
  });
});

describe("reoon adapter", () => {
  it("maps quick-mode statuses", () => {
    expect(mapReoonStatus("valid")).toEqual({ classification: "deliverable", detail: null });
    expect(mapReoonStatus("invalid")).toEqual({ classification: "undeliverable", detail: "mailbox_not_found" });
    expect(mapReoonStatus("disposable")).toEqual({ classification: "risky", detail: "disposable" });
    expect(mapReoonStatus("spamtrap")).toEqual({ classification: "risky", detail: null });
  });

  it("maps power-mode statuses", () => {
    expect(mapReoonStatus("safe").classification).toBe("deliverable");
    expect(mapReoonStatus("disabled").classification).toBe("undeliverable");
    expect(mapReoonStatus("catch_all")).toEqual({ classification: "risky", detail: "catch_all" });
    expect(mapReoonStatus("role_account")).toEqual({ classification: "risky", detail: "role" });
    expect(mapReoonStatus("inbox_full").classification).toBe("risky");
    expect(mapReoonStatus("unknown").classification).toBe("unknown");
  });

  it("degrades an unrecognised status to unknown", () => {
    expect(mapReoonStatus("something_new").classification).toBe("unknown");
    expect(mapReoonStatus("").classification).toBe("unknown");
  });

  it("carries the role flag through on a deliverable answer", () => {
    expect(mapReoonStatus("safe", { is_role_account: true }).detail).toBe("role");
  });

  it("reads quota exhaustion out of the documented error payload", () => {
    expect(classifyReoonError("You have no credits left")).toBe("quota");
    expect(classifyReoonError("Monthly limit exceeded")).toBe("quota");
    expect(classifyReoonError("Insufficient balance")).toBe("quota");
    expect(classifyReoonError("Invalid API key")).toBe("auth");
    expect(classifyReoonError("Subscription expired")).toBe("auth");
    expect(classifyReoonError("Something broke")).toBe("error");
  });

  it("classifies HTTP statuses", () => {
    expect(classifyReoonHttp(200)).toBeNull();
    expect(classifyReoonHttp(401)).toBe("auth");
    expect(classifyReoonHttp(402)).toBe("quota");
    expect(classifyReoonHttp(429)).toBe("quota");
    expect(classifyReoonHttp(500)).toBe("error");
  });

  it("treats a missing or blank key as 'skip me', never an exception", async () => {
    delete process.env.REOON_API_KEY;
    expect(getReoonKey()).toBeNull();
    expect(reoon.isConfigured()).toBe(false);
    await expect(reoon.verify("a@b.com")).resolves.toEqual({
      ok: false,
      reason: "auth",
      message: expect.any(String),
    });

    process.env.REOON_API_KEY = "  ";
    expect(reoon.isConfigured()).toBe(false);

    process.env.REOON_API_KEY = "k";
    expect(reoon.isConfigured()).toBe(true);
  });
});
