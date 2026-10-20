// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { DomainSearch } from "@/lib/domains/service";

/** The assistant's domain check says plainly whether the EXACT name is free, apart from alternatives. */

const offer = (domain: string, available: boolean) => ({
  domain, registrar: "cloudflare" as const, available, reason: available ? null : "Taken",
  registrationCents: available ? 1046 : null, renewalCents: available ? 1046 : null, currency: "USD",
});
const found: DomainSearch = {
  query: "ABC Construction",
  exact: { domain: "abcconstruction.com", assumedTld: true, offer: offer("abcconstruction.com", false) },
  otherEndings: [offer("abcconstruction.net", true)],
  similar: [offer("abccontractor.com", true)],
};

vi.mock("@/lib/domains/service", async (orig) => ({ ...(await orig<object>()), searchDomainNames: vi.fn(async () => found) }));
vi.mock("@/lib/cloudflare/client", async (orig) => ({ ...(await orig<object>()), cloudflareConfigured: () => true }));
vi.mock("@/lib/hostinger/client", async (orig) => ({ ...(await orig<object>()), hostingerConfigured: () => false }));

const { checkDomainTool } = await import("@/lib/assistant/tools/actions");

describe("check_domain", () => {
  it("reports the exact name (as .com) first — taken — and the rest as different names", async () => {
    const ctx = { act: { mode: "act" } } as never;
    const out = await checkDomainTool.run({ domain: "ABC Construction" }, ctx);
    expect(out.summary).toBe("abcconstruction.com is not available");
    expect(out.data).toMatchObject({
      exact_match: { domain: "abcconstruction.com", available: false },
      alternatives: [{ domain: "abcconstruction.net" }, { domain: "abccontractor.com" }],
      note: expect.stringMatching(/DIFFERENT names/),
    });
  });
});
