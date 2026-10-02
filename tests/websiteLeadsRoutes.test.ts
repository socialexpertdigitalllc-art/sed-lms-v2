// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// Leads from the agency's own website land in website_leads (Website →
// Leads), never in Form Relay: intake validation, spam filing, coupon
// verdicts, the notification, and the dashboard-side status workflow.

const holder = vi.hoisted(() => ({
  apiKey: "",
  user: { id: "u1" } as { id: string } | null,
  perms: new Set<string>(),
  inserted: [] as { table: string; row: Record<string, unknown> }[],
  updated: [] as { table: string; patch: Record<string, unknown> }[],
  coupon: null as Record<string, unknown> | null,
  current: { contacted_at: null as string | null },
  notified: [] as { key: string; opts: Record<string, unknown> }[],
}));

vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    void fn();
  },
}));
vi.mock("@/lib/notifications/notify", () => ({
  notify: vi.fn(async (key: string, _ctx: unknown, opts: Record<string, unknown>) => {
    holder.notified.push({ key, opts });
  }),
}));
vi.mock("@/lib/website-cms/settings", () => ({
  getWebsiteSettings: async () => ({ api_key: holder.apiKey, stats: {}, revalidate_url: "", revalidate_secret: "" }),
  invalidateWebsiteSettingsCache: () => {},
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: holder.user } }) } }),
}));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "website_coupons" ? holder.coupon : holder.current,
            error: null,
          }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        holder.inserted.push({ table, row });
        return {
          select: () => ({ single: async () => ({ data: { id: "lead-1234-abcd" }, error: null }) }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
        };
      },
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => {
              holder.updated.push({ table, patch });
              return { data: { id: "lead-1" }, error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

import { POST as intake } from "@/app/api/public/leads/route";
import { PATCH } from "@/app/api/website/leads/[id]/route";
import { resetIpRate } from "@/lib/forms/gate";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://t/api/public/leads", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const lead = {
  name: "Jane Smith",
  email: "jane@example.com",
  phone: "555-1234",
  message: "Need a site",
  service_slug: "website-development",
  tier_name: "growth",
  source_page: "/contact?service=website-development",
  utm_source: "google",
  ip: "1.2.3.4",
  user_agent: "UA",
  elapsed_ms: 9000,
};

beforeEach(() => {
  holder.apiKey = "";
  holder.user = { id: "u1" };
  holder.perms = new Set(["website.manage"]);
  holder.inserted = [];
  holder.updated = [];
  holder.coupon = null;
  holder.current = { contacted_at: null };
  holder.notified = [];
  resetIpRate();
});

describe("POST /api/public/leads", () => {
  it("files a real lead in website_leads with attribution, and notifies", async () => {
    const res = await intake(post(lead));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    const row = holder.inserted.find((i) => i.table === "website_leads")!.row;
    expect(row).toMatchObject({
      name: "Jane Smith",
      service_slug: "website-development",
      tier_name: "growth",
      utm_source: "google",
      ip: "1.2.3.4",
      is_spam: false,
      spam_reason: null,
    });
    expect(holder.inserted.some((i) => i.table.startsWith("form_"))).toBe(false);
    expect(holder.notified).toHaveLength(1);
    expect(holder.notified[0].key).toBe("website_lead_received");
  });

  it("honeypot and too-fast submissions are recorded as spam, answered ok, never notified", async () => {
    expect((await intake(post({ ...lead, company_website: "bot.biz" }))).status).toBe(200);
    expect((await intake(post({ ...lead, ip: "9.9.9.9", elapsed_ms: 300 }))).status).toBe(200);
    const rows = holder.inserted.filter((i) => i.table === "website_leads").map((i) => i.row);
    expect(rows.map((r) => r.spam_reason)).toEqual(["honeypot", "too_fast"]);
    expect(holder.notified).toHaveLength(0);
  });

  it("validation errors come back as 422 with the visitor-facing message", async () => {
    const res = await intake(post({ ...lead, email: "nope" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/valid email/);
  });

  it("rate-limits per relayed visitor IP, not the website server's", async () => {
    for (let i = 0; i < 10; i++) expect((await intake(post(lead))).status).toBe(200);
    expect((await intake(post(lead))).status).toBe(429);
    // a different visitor behind the same website server is unaffected
    expect((await intake(post({ ...lead, ip: "5.6.7.8" }))).status).toBe(200);
  });

  it("stores the coupon verdict at submit time", async () => {
    holder.coupon = {
      code: "SAVE20", label: "", discount_type: "percent", amount: 20, service_slugs: [], active: true, expires_at: null,
    };
    await intake(post({ ...lead, coupon: "save20" }));
    const row = holder.inserted.find((i) => i.table === "website_leads")!.row;
    expect(row).toMatchObject({ coupon: "SAVE20", coupon_valid: true });
  });

  it("demands the publishable key once one is configured", async () => {
    holder.apiKey = "k1";
    expect((await intake(post(lead))).status).toBe(401);
    expect((await intake(post(lead, { "x-sed-key": "k1" }))).status).toBe(200);
  });
});

describe("PATCH /api/website/leads/[id]", () => {
  const ctx = { params: Promise.resolve({ id: "lead-1" }) };
  const patch = (body: unknown) =>
    new Request("http://t/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("needs website.manage", async () => {
    holder.perms = new Set(["website.view"]);
    expect((await PATCH(patch({ status: "contacted" }), ctx)).status).toBe(403);
  });

  it("first move out of new stamps contacted_at and the owner", async () => {
    expect((await PATCH(patch({ status: "contacted", notes: "called" }), ctx)).status).toBe(200);
    const p = holder.updated[0].patch;
    expect(p).toMatchObject({ status: "contacted", notes: "called", assigned_to: "u1" });
    expect(p.contacted_at).toBeTruthy();
  });

  it("marking spam records a manual reason", async () => {
    await PATCH(patch({ is_spam: true }), ctx);
    expect(holder.updated[0].patch).toMatchObject({ is_spam: true, spam_reason: "manual" });
  });

  it("rejects unknown statuses", async () => {
    expect((await PATCH(patch({ status: "maybe" }), ctx)).status).toBe(422);
  });
});

describe("wiring", () => {
  it("migration 0082 creates website_leads and its notification rule", () => {
    const sql = readFileSync("supabase/migrations/0082_website_leads.sql", "utf8");
    expect(sql).toContain("create table if not exists public.website_leads");
    expect(sql).toContain("'website_lead_received'");
  });
  it("the Website module has a Leads tab", () => {
    expect(readFileSync("components/website-cms/WebsiteTabs.tsx", "utf8")).toMatch(/"\/website\/leads"/);
  });
});
