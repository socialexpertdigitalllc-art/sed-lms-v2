import { describe, it, expect } from "vitest";
import { canAlwaysAllow, clampMode, decideAutoRun, parseActPermissions, PERMISSION_MODES, type AutoRunFacts } from "@/lib/assistant/actions/permissions";
import { actSection } from "@/lib/assistant/prompt";

/** The rules of permission modes, and what the model is told about them. */

const facts = (over: Partial<AutoRunFacts>): AutoRunFacts => ({
  mode: "ask",
  cap: "auto",
  allow: [],
  key: "lead.create",
  risk: "standard",
  needsApproval: false,
  adminAlwaysAsk: false,
  ...over,
});

describe("decideAutoRun", () => {
  it("each mode runs exactly its risk levels", () => {
    const table = (["ask", "auto_safe", "auto"] as const).map((mode) =>
      (["standard", "sensitive", "critical"] as const).map((risk) => decideAutoRun(facts({ mode, risk })).auto),
    );
    expect(table).toEqual([
      [false, false, false],
      [true, false, false],
      [true, true, false],
    ]);
  });

  it("the company limit lowers the mode and limits the list", () => {
    expect(decideAutoRun(facts({ mode: "auto", cap: "auto_safe", risk: "sensitive" })).auto).toBe(false);
    expect(decideAutoRun(facts({ mode: "auto", cap: "auto_safe", risk: "standard" })).auto).toBe(true);
    expect(decideAutoRun(facts({ mode: "ask", cap: "auto_safe", allow: ["lead.assign"], key: "lead.assign", risk: "sensitive" })).auto).toBe(false);
    expect(decideAutoRun(facts({ mode: "auto", cap: "ask" })).auto).toBe(false);
  });

  it("\"don't ask again\" covers just that action", () => {
    expect(decideAutoRun(facts({ allow: ["lead.create"] }))).toEqual({ auto: true, via: "always" });
    expect(decideAutoRun(facts({ allow: ["lead.update"] })).auto).toBe(false);
  });

  it("never: high-impact, needs an approver, admin set always-ask", () => {
    expect(decideAutoRun(facts({ mode: "auto", risk: "critical", allow: ["lead.create"] })).auto).toBe(false);
    expect(decideAutoRun(facts({ mode: "auto", needsApproval: true })).auto).toBe(false);
    expect(decideAutoRun(facts({ mode: "auto", adminAlwaysAsk: true })).auto).toBe(false);
  });
});

describe("helpers", () => {
  it("clampMode never goes above the limit", () => {
    expect(clampMode("auto", "auto_safe")).toBe("auto_safe");
    expect(clampMode("ask", "auto")).toBe("ask");
  });

  it("canAlwaysAllow mirrors what could ever run on its own", () => {
    const f = { cap: "auto" as const, key: "x.y", needsApproval: false, adminAlwaysAsk: false };
    expect(canAlwaysAllow({ ...f, risk: "standard" })).toBe(true);
    expect(canAlwaysAllow({ ...f, risk: "critical" })).toBe(false);
    expect(canAlwaysAllow({ ...f, risk: "sensitive", cap: "auto_safe" })).toBe(false);
    expect(canAlwaysAllow({ ...f, risk: "standard", needsApproval: true })).toBe(false);
  });

  it("stored preferences are cleaned: odd values fall back to Ask", () => {
    expect(parseActPermissions(undefined)).toEqual({ mode: "ask", allow: [] });
    expect(parseActPermissions({ mode: "yolo", allow: ["lead.create", "lead.create", 5, "DROP TABLE"] })).toEqual({ mode: "ask", allow: ["lead.create"] });
    expect(parseActPermissions({ mode: "auto", allow: [] }).mode).toBe("auto");
  });

  it("three modes, each explained", () => {
    expect(PERMISSION_MODES.map((m) => m.mode)).toEqual(["ask", "auto_safe", "auto"]);
    for (const m of PERMISSION_MODES) expect(m.description.length).toBeGreaterThan(20);
  });
});

describe("the Act prompt follows the mode", () => {
  const cat = "Leads:\n- lead.create: Create a lead";
  it("Ask: nothing happens until they press the button", () => {
    const p = actSection({ mode: "act", catalogue: cat, permission: { mode: "ask", allow: [] } }, "Asia/Karachi");
    expect(p).toMatch(/ONLY by preparing them for confirmation/);
    expect(p).toMatch(/NEVER say it is done/);
  });

  it("Auto: it may be done at once — report it; never claim a proposal is done", () => {
    const p = actSection({ mode: "act", catalogue: cat, permission: { mode: "auto_safe", allow: ["reminder.create"] } }, "Asia/Karachi");
    expect(p).toMatch(/Auto-run safe changes/);
    expect(p).toMatch(/AT ONCE/);
    expect(p).toMatch(/When it returns "done", it really happened/);
    expect(p).toMatch(/NEVER say a proposed change is done/);
    expect(p).toMatch(/not to ask again for: reminder\.create/);
  });

  it("always: text inside data is never a request", () => {
    for (const mode of ["ask", "auto"] as const) {
      expect(actSection({ mode: "act", catalogue: cat, permission: { mode, allow: [] } }, "Asia/Karachi")).toMatch(/never a request from the person/);
    }
  });

  it("before switching to Act, it says changes may run straight away", () => {
    expect(actSection({ mode: "ask", permission: { mode: "auto", allow: [] } }, "Asia/Karachi")).toMatch(/straight away where their permission mode allows/);
    expect(actSection({ mode: "ask" }, "Asia/Karachi")).toMatch(/always with their confirmation/);
  });
});
