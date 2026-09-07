// tests/formsSubmitRoute.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetIpRate } from "@/lib/forms/gate";

const holder = vi.hoisted(() => ({
  endpoint: null as Record<string, unknown> | null,
  endpointError: null as { message: string } | null,
  todayCount: 0,
  inserted: [] as Record<string, unknown>[],
  after: [] as (() => Promise<void> | void)[],
  delivered: [] as string[],
}));

vi.mock("next/server", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => Promise<void> | void) => { holder.after.push(fn); } };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "form_endpoints") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: holder.endpoint, error: holder.endpointError }) }) }) };
      }
      return {
        select: (_c: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) return { eq: () => ({ eq: () => ({ gte: async () => ({ count: holder.todayCount, error: null }) }) }) };
          return {};
        },
        insert: (row: Record<string, unknown>) => {
          holder.inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "sub-1", ...row }, error: null }) }) };
        },
      };
    },
  }),
}));
vi.mock("@/lib/forms/deliver", () => ({ deliverSubmission: async (id: string) => { holder.delivered.push(id); return { status: "sent" }; } }));

import { POST, OPTIONS } from "@/app/api/forms/submit/route";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("http://t/api/forms/submit", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://acme.com", "x-forwarded-for": "1.2.3.4", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

beforeEach(() => {
  resetIpRate();
  holder.endpoint = { id: "e1", lead_id: "l1", name: "Acme", access_key: "KEY", status: "active", allowed_origins: [], daily_limit: 200, subject_template: "", success_redirect_url: null };
  holder.endpointError = null;
  holder.todayCount = 0;
  holder.inserted = [];
  holder.after = [];
  holder.delivered = [];
});

describe("OPTIONS /api/forms/submit", () => {
  it("answers preflight with CORS headers", async () => {
    const res = await OPTIONS(new Request("http://t/x", { method: "OPTIONS", headers: { origin: "https://acme.com" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://acme.com");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("POST /api/forms/submit", () => {
  it("stores, replies web3forms-style, and delivers after the response", async () => {
    const res = await post({ access_key: "KEY", name: "Ann", email: "ann@x.co", message: "Hi" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://acme.com");
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ name: "Ann", email: "ann@x.co", message: "Hi" });
    expect(holder.inserted[0]).toMatchObject({ endpoint_id: "e1", lead_id: "l1", submitter_email: "ann@x.co", ip: "1.2.3.4", origin: "acme.com", is_spam: false, delivery_status: "pending" });
    expect(holder.delivered).toEqual([]);
    for (const fn of holder.after) await fn();
    expect(holder.delivered).toEqual(["sub-1"]);
  });

  it("accepts FormData", async () => {
    const fd = new FormData(); fd.append("access_key", "KEY"); fd.append("name", "Ann");
    const res = await POST(new Request("http://t/x", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
  });

  it("404s an unknown key, 410s a paused endpoint, 400s a missing key", async () => {
    holder.endpoint = null;
    expect((await post({ access_key: "nope" })).status).toBe(404);
    holder.endpoint = { id: "e1", status: "paused", allowed_origins: [], daily_limit: 1 };
    expect((await post({ access_key: "KEY" })).status).toBe(410);
    expect((await post({ name: "x" })).status).toBe(400);
  });

  it("stores honeypot hits as spam and fakes success", async () => {
    const res = await post({ access_key: "KEY", botcheck: "on", name: "bot" });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(holder.inserted[0]).toMatchObject({ is_spam: true, spam_reason: "honeypot", delivery_status: "skipped" });
    expect(holder.after).toEqual([]);
  });

  it("403s and records an origin mismatch", async () => {
    holder.endpoint!.allowed_origins = ["acme.com"];
    const res = await post({ access_key: "KEY" }, { origin: "https://evil.com" });
    expect(res.status).toBe(403);
    expect(holder.inserted[0]).toMatchObject({ is_spam: true, spam_reason: "origin" });
  });

  it("429s over the daily limit", async () => {
    holder.todayCount = 200;
    expect((await post({ access_key: "KEY" })).status).toBe(429);
    expect(holder.inserted[0]).toMatchObject({ spam_reason: "rate_daily" });
  });

  it("303-redirects plain HTML posts", async () => {
    const res = await post("access_key=KEY&name=Ann&redirect=https%3A%2F%2Facme.com%2Fthanks", { "content-type": "application/x-www-form-urlencoded", accept: "text/html,application/xhtml+xml" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://acme.com/thanks");
  });

  it("503s when the tables are missing", async () => {
    holder.endpoint = null;
    holder.endpointError = { message: 'relation "public.form_endpoints" does not exist' };
    const res = await post({ access_key: "KEY" });
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe("Form relay not ready");
  });
});
