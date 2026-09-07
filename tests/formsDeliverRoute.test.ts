// tests/formsDeliverRoute.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const holder = vi.hoisted(() => ({
  rows: [] as { id: string }[],
  delivered: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ or: () => ({ lt: () => ({ order: () => ({ limit: async () => ({ data: holder.rows, error: null }) }) }) }) }),
      delete: () => ({ eq: () => ({ lt: async () => ({ error: null }) }) }),
    }),
  }),
}));
vi.mock("@/lib/forms/deliver", () => ({ deliverSubmission: async (id: string) => { holder.delivered.push(id); return { status: "sent" }; } }));

import { POST } from "@/app/api/forms/deliver/route";

const saved = process.env.WGE_PROCESSOR_SECRET;
beforeEach(() => { process.env.WGE_PROCESSOR_SECRET = "s3cret"; holder.rows = [{ id: "a" }, { id: "b" }]; holder.delivered = []; });
afterEach(() => { if (saved === undefined) delete process.env.WGE_PROCESSOR_SECRET; else process.env.WGE_PROCESSOR_SECRET = saved; });

const call = (secret?: string) => POST(new Request("http://t/x", { method: "POST", headers: secret ? { "x-wge-secret": secret } : {} }));

describe("POST /api/forms/deliver", () => {
  it("503s when unconfigured, 401s on a wrong secret", async () => {
    delete process.env.WGE_PROCESSOR_SECRET;
    expect((await call("x")).status).toBe(503);
    process.env.WGE_PROCESSOR_SECRET = "s3cret";
    expect((await call("wrong")).status).toBe(401);
    expect((await call()).status).toBe(401);
  });
  it("delivers every eligible row and reports", async () => {
    const res = await call("s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 2, sent: 2, failed: 0 });
    expect(holder.delivered).toEqual(["a", "b"]);
  });
});
