// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  isDisposable,
  isFreeProvider,
  isPrivacyRelay,
  isRequiredMailbox,
  isRoleAccount,
  ROLE_NAMES,
} from "@/lib/email-verify/lists";

describe("email-verify lists", () => {
  it("flags known disposable domains, case-insensitively", () => {
    expect(isDisposable("mailinator.com")).toBe(true);
    expect(isDisposable("MAILINATOR.COM")).toBe(true);
    expect(isDisposable("guerrillamail.com")).toBe(true);
    expect(isDisposable("yopmail.com")).toBe(true);
    expect(isDisposable("example.com")).toBe(false);
    expect(isDisposable("")).toBe(false);
  });

  it("NEVER flags a privacy relay as disposable", () => {
    for (const d of [
      "privaterelay.appleid.com",
      "relay.firefox.com",
      "mozmail.com",
      "duck.com",
      "simplelogin.com",
      "simplelogin.io",
      "anonaddy.me",
    ]) {
      expect(isPrivacyRelay(d)).toBe(true);
      expect(isDisposable(d)).toBe(false);
    }
  });

  it("carries the RFC 2142 role names", () => {
    for (const n of [
      "info",
      "sales",
      "support",
      "admin",
      "billing",
      "contact",
      "help",
      "marketing",
      "abuse",
      "noc",
      "security",
      "postmaster",
      "hostmaster",
      "webmaster",
    ]) {
      expect(ROLE_NAMES.has(n)).toBe(true);
      expect(isRoleAccount(n)).toBe(true);
    }
  });

  it("detects role accounts case-insensitively and through sub-addressing", () => {
    expect(isRoleAccount("Sales")).toBe(true);
    expect(isRoleAccount("sales+eu")).toBe(true);
    expect(isRoleAccount("salesperson")).toBe(false);
    expect(isRoleAccount("milton")).toBe(false);
  });

  it("marks postmaster as a mailbox every mail domain must accept", () => {
    expect(isRequiredMailbox("postmaster")).toBe(true);
    expect(isRequiredMailbox("PostMaster")).toBe(true);
    expect(isRequiredMailbox("postmaster+x")).toBe(true);
    expect(isRequiredMailbox("sales")).toBe(false);
  });

  it("recognises consumer mailbox providers", () => {
    expect(isFreeProvider("gmail.com")).toBe(true);
    expect(isFreeProvider("Outlook.com")).toBe(true);
    expect(isFreeProvider("sed-lms.io")).toBe(false);
  });
});
