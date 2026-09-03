import { describe, it, expect } from "vitest";
import {
  baseSubdomain,
  parseVersion,
  versionedSubdomain,
  nextVersionSubdomain,
  firstFreeVersion,
} from "@/lib/site-studio/deploy/naming";

/**
 * The subdomain is a link we SEND THE CLIENT. A random tail or a truncated
 * stub reads as phishing and the client does not open the site we just built
 * them, so the clean business name is the product requirement — a counter
 * appears only when the name is genuinely taken.
 */

const taken = (...subs: string[]) => async (s: string) => subs.includes(s);

describe("baseSubdomain", () => {
  it("uses the WHOLE business name, not the first two words", () => {
    expect(baseSubdomain("A M Handyman")).toBe("a-m-handyman");
  });

  it("keeps every word of a longer name", () => {
    expect(baseSubdomain("Ridgeline Roofing And Siding")).toBe("ridgeline-roofing-and-siding");
  });

  it("collapses punctuation and casing into single hyphens", () => {
    expect(baseSubdomain("  Joe's   Plumbing, LLC.  ")).toBe("joe-s-plumbing-llc");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(baseSubdomain("Café Móvil")).toBe("cafe-movil");
  });

  it("falls back to 'site' when nothing DNS-safe survives", () => {
    expect(baseSubdomain("!!!")).toBe("site");
    expect(baseSubdomain("")).toBe("site");
  });

  it("stays inside the 63-octet DNS label limit, with no trailing hyphen", () => {
    const long = baseSubdomain("A".repeat(30) + " " + "B".repeat(60));
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("versioning", () => {
  it("version 1 IS the bare name — no suffix at all", () => {
    expect(versionedSubdomain("a-m-handyman", 1)).toBe("a-m-handyman");
  });

  it("a real collision counts up in a readable way", () => {
    expect(versionedSubdomain("a-m-handyman", 2)).toBe("a-m-handyman-2");
    expect(nextVersionSubdomain("a-m-handyman")).toBe("a-m-handyman-2");
    expect(nextVersionSubdomain("a-m-handyman-2")).toBe("a-m-handyman-3");
  });

  it("keeps the counter inside the label limit by trimming the NAME", () => {
    const base = "b".repeat(63);
    const out = versionedSubdomain(base, 12);
    expect(out.length).toBeLessThanOrEqual(63);
    expect(out.endsWith("-12")).toBe(true);
  });

  it("versions legacy vN sites forward without mutating their base", () => {
    // Sites deployed under the old scheme are still live.
    expect(parseVersion("joes-plumbingv2")).toEqual({ base: "joes-plumbing", version: 2 });
    expect(nextVersionSubdomain("joes-plumbingv2")).toBe("joes-plumbing-3");
  });

  it("reads an unsuffixed name as version 1", () => {
    expect(parseVersion("a-m-handyman")).toEqual({ base: "a-m-handyman", version: 1 });
  });
});

describe("firstFreeVersion", () => {
  it("hands back the clean name when nothing owns it", async () => {
    expect(await firstFreeVersion("a-m-handyman", taken())).toBe("a-m-handyman");
  });

  it("only adds a counter once the clean name is actually taken", async () => {
    expect(await firstFreeVersion("a-m-handyman", taken("a-m-handyman"))).toBe("a-m-handyman-2");
  });

  it("keeps counting past a run of taken names", async () => {
    const exists = taken("acme", "acme-2", "acme-3");
    expect(await firstFreeVersion("acme", exists)).toBe("acme-4");
  });

  it("honours `skip` so a shuffle cannot return the name it is replacing", async () => {
    expect(await firstFreeVersion("acme", taken(), { skip: "acme" })).toBe("acme-2");
  });

  it("never returns a name containing random characters", async () => {
    const out = await firstFreeVersion(baseSubdomain("A M Handyman"), taken());
    expect(out).toMatch(/^[a-z0-9-]+$/);
    expect(out).toBe("a-m-handyman");
  });
});
