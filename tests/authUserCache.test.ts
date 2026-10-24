import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserResponse } from "@supabase/supabase-js";
import { ttlResetAll } from "@/lib/cache/ttl";

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

import { verifyUserCached } from "@/lib/supabase/server";

/**
 * getUser() is verified against GoTrue once per token per minute, not once per
 * request: prod measured ~16,000 /auth/v1/user calls a day at ~300 ms each.
 */
const ok = (id: string): UserResponse => ({ data: { user: { id } as never }, error: null });
const failed: UserResponse = { data: { user: null }, error: { message: "nope" } as never };
const session = (token: string | null) => async () => ({ data: { session: token ? { access_token: token } : null } });

beforeEach(() => ttlResetAll());

describe("verifyUserCached", () => {
  it("verifies a token once and reuses the answer", async () => {
    const verify = vi.fn(async () => ok("u1"));
    expect((await verifyUserCached(session("tokA"), verify)).data.user?.id).toBe("u1");
    expect((await verifyUserCached(session("tokA"), verify)).data.user?.id).toBe("u1");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("keys by token — a different token is a different person", async () => {
    const verify = vi.fn(async () => ok("x"));
    await verifyUserCached(session("tokA"), verify);
    await verifyUserCached(session("tokB"), verify);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("never caches a failed verification", async () => {
    const verify = vi.fn(async () => failed);
    expect((await verifyUserCached(session("tokA"), verify)).error).toBeTruthy();
    expect((await verifyUserCached(session("tokA"), verify)).error).toBeTruthy();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("falls straight through when there is no session cookie", async () => {
    const verify = vi.fn(async () => failed);
    await verifyUserCached(session(null), verify);
    await verifyUserCached(session(null), verify);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("re-verifies after the TTL", async () => {
    let t = 0;
    const verify = vi.fn(async () => ok("u1"));
    await verifyUserCached(session("tokA"), verify, () => t);
    t = 59_000;
    await verifyUserCached(session("tokA"), verify, () => t);
    expect(verify).toHaveBeenCalledTimes(1);
    t = 61_000;
    await verifyUserCached(session("tokA"), verify, () => t);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});
