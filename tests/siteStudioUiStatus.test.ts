import { describe, it, expect } from "vitest";
import {
  statusPill, groupDiagnostics, canCertify, nextStepHint, blockerCount,
} from "@/lib/site-studio/ui/status";
import type { Diagnostic } from "@/lib/site-studio/schema";

const d = (level: Diagnostic["level"], code: string, page?: string): Diagnostic =>
  ({ level, code, message: `${code} message`, ...(page ? { page } : {}) });

describe("statusPill", () => {
  it("maps every status to a tone and label", () => {
    expect(statusPill("uploaded")).toEqual({ tone: "neutral", label: "Uploaded" });
    expect(statusPill("needs_review")).toEqual({ tone: "notready", label: "Needs review" });
    expect(statusPill("certified")).toEqual({ tone: "ready", label: "Certified" });
    expect(statusPill("rejected")).toEqual({ tone: "dropped", label: "Rejected" });
    expect(statusPill("disabled")).toEqual({ tone: "neutral", label: "Disabled" });
  });
});

describe("groupDiagnostics", () => {
  it("splits by level, newest-code-first order preserved within a level", () => {
    const g = groupDiagnostics([d("warn", "a"), d("blocker", "b"), d("info", "c"), d("warn", "e")]);
    expect(g.blockers.map((x) => x.code)).toEqual(["b"]);
    expect(g.warnings.map((x) => x.code)).toEqual(["a", "e"]);
    expect(g.infos.map((x) => x.code)).toEqual(["c"]);
  });
  it("handles null/undefined diagnostics", () => {
    expect(groupDiagnostics(undefined)).toEqual({ blockers: [], warnings: [], infos: [] });
  });
});

describe("blockerCount / canCertify", () => {
  it("certify needs needs_review + a manifest + zero blockers", () => {
    expect(canCertify("needs_review", true, [])).toBe(true);
    expect(canCertify("needs_review", true, [d("warn", "w")])).toBe(true);
    expect(canCertify("needs_review", true, [d("blocker", "b")])).toBe(false);
    expect(canCertify("needs_review", false, [])).toBe(false);
    expect(canCertify("uploaded", true, [])).toBe(false);
    expect(canCertify("certified", true, [])).toBe(false);
  });
  it("counts only blockers", () => {
    expect(blockerCount([d("blocker", "a"), d("warn", "b"), d("blocker", "c")])).toBe(2);
    expect(blockerCount(undefined)).toBe(0);
  });
});

describe("nextStepHint", () => {
  it("tells the operator what to do next from each state", () => {
    expect(nextStepHint({ status: "uploaded", hasManifest: false, diagnostics: [] })).toMatch(/compile/i);
    expect(nextStepHint({ status: "uploaded", hasManifest: false, diagnostics: [d("blocker", "no_pages")] })).toMatch(/blocking/i);
    expect(nextStepHint({ status: "needs_review", hasManifest: true, diagnostics: [] })).toMatch(/review|certify/i);
    expect(nextStepHint({ status: "needs_review", hasManifest: true, diagnostics: [d("blocker", "x")] })).toMatch(/blocking/i);
    expect(nextStepHint({ status: "certified", hasManifest: true, diagnostics: [] })).toMatch(/ready/i);
    expect(nextStepHint({ status: "rejected", hasManifest: true, diagnostics: [] })).toMatch(/rejected/i);
    expect(nextStepHint({ status: "disabled", hasManifest: true, diagnostics: [] })).toMatch(/disabled/i);
  });
});
