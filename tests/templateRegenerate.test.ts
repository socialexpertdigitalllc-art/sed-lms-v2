import { describe, it, expect } from "vitest";
import { REGEN_SYSTEM } from "@/lib/template-engine/regenerate";

// The header logo-vs-name behaviour is enforced entirely through the shared
// copy-editor system prompt (the templates themselves are not in-repo). These
// guards lock the rule in so a future prompt refactor can't silently drop it.
describe("REGEN_SYSTEM header logo/name rule", () => {
  it("keys the logo/name decision off identity.logo_url", () => {
    expect(REGEN_SYSTEM).toContain("identity.logo_url is non-empty");
    expect(REGEN_SYSTEM).toContain("identity.logo_url is empty");
  });

  it("hides (not deletes) the business-name wordmark when a logo is present", () => {
    // Must add a `hidden` attribute and explicitly forbid deletion, so the
    // structure gate (which fails on any lost tag/class/id) stays satisfied.
    expect(REGEN_SYSTEM).toMatch(/hidden.*attribute/i);
    expect(REGEN_SYSTEM).toMatch(/never delete it/i);
  });

  it("still falls back to the business name when there is no logo or no image slot", () => {
    expect(REGEN_SYSTEM).toMatch(/render the business name as text/i);
    expect(REGEN_SYSTEM).toMatch(/no <img> slot/i);
  });
});
