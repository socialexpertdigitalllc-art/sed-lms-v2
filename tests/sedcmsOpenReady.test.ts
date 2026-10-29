// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { memorySupabase } from "./helpers/memorySupabase";
import { cmsOpenReady } from "@/lib/sedcms/cms";

/**
 * "Open in CMS" shows only once the CMS is connected (SEDCMS_URL and
 * SEDCMS_API_KEY valid) and migration 0096 is applied, so between the LMS's
 * deploy and the Studio's launch nobody sees a button that could only answer
 * "not connected". The route keeps its 503s as a backstop
 * (tests/sedcmsOpen.test.ts).
 */

const CMS = { SEDCMS_URL: "https://cms.sedsolutions.online", SEDCMS_API_KEY: "sedcms-test-api-key-not-a-real-one", NODE_ENV: "production" };

/** An admin client that counts what it is asked, and answers sedcms_links as told. */
function admin(answer: { error: { message: string } | null } | "throws" = { error: null }) {
  const asked: string[] = [];
  const db = memorySupabase({ sedcms_links: [] });
  return {
    asked,
    client: {
      from: (table: string) => {
        asked.push(table);
        if (table !== "sedcms_links" || (answer !== "throws" && !answer.error)) return db.client.from(table);
        if (answer === "throws") throw new Error("network down");
        return { select: () => ({ limit: async () => ({ data: null, error: answer.error }) }) };
      },
    } as never,
  };
}

describe("cmsOpenReady", () => {
  it("is true when the CMS link is configured and migration 0096's table answers", async () => {
    const a = admin();
    expect(await cmsOpenReady(a.client, CMS)).toBe(true);
    expect(a.asked).toEqual(["sedcms_links"]);
  });

  it("is false, asking the database nothing, while SEDCMS_URL or SEDCMS_API_KEY is missing or invalid", async () => {
    for (const env of [
      { ...CMS, SEDCMS_URL: undefined },
      { ...CMS, SEDCMS_API_KEY: undefined },
      { ...CMS, SEDCMS_API_KEY: ` ${CMS.SEDCMS_API_KEY}` },
      { ...CMS, SEDCMS_URL: "http://cms.sedsolutions.online" },
      { ...CMS, SEDCMS_URL: "https://cms.sedsolutions.online/studio" },
      { ...CMS, SEDCMS_URL: "not a url" },
    ]) {
      const a = admin();
      expect(await cmsOpenReady(a.client, env), JSON.stringify(env)).toBe(false);
      expect(a.asked).toEqual([]);
    }
  });

  it("is false while migration 0096 isn't applied", async () => {
    for (const message of ['relation "public.sedcms_links" does not exist', "Could not find the table 'public.sedcms_links' in the schema cache"]) {
      expect(await cmsOpenReady(admin({ error: { message } }).client, CMS), message).toBe(false);
    }
  });

  it("is false when the database can't be asked: the button stays hidden, never broken", async () => {
    expect(await cmsOpenReady(admin({ error: { message: "canceling statement due to statement timeout" } }).client, CMS)).toBe(false);
    expect(await cmsOpenReady(admin("throws").client, CMS)).toBe(false);
  });

  it("is what the lead and ticket pages pass down, asked only for someone who could see the button", () => {
    for (const page of ["app/(app)/leads/[id]/page.tsx", "app/(app)/tickets/[id]/page.tsx"]) {
      const src = readFileSync(page, "utf8");
      expect(src, page).toMatch(/const cmsReady =\s[^;]*\? await cmsOpenReady\(admin\) : false;/);
      expect(src, page).toContain("cmsReady={cmsReady}");
    }
    expect(readFileSync("app/(app)/leads/[id]/page.tsx", "utf8")).toMatch(/const cmsReady =\s*\(perms\.has\("tickets\.resolve"\) \|\| perms\.has\("studio\.manage"\)\) && Boolean\(lead\.website_link\)/);
    expect(readFileSync("app/(app)/tickets/[id]/page.tsx", "utf8")).toMatch(/const cmsReady = canViewAgentRuns && Boolean\(lead\.website_link\)/);
  });
});
