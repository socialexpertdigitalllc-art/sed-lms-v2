// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchBuilderImages, recordBuilderImage, type BuilderImageRow } from "@/lib/site-builder/imageLibrary";

/**
 * The Site Builder image library holds LINKS. These tests pin the two
 * properties that matter: the lead fence can never widen under bad input,
 * and recording is bookkeeping that must never cost the operator a pick.
 */

function row(overrides: Partial<BuilderImageRow> = {}): BuilderImageRow {
  return {
    id: "img-1",
    url: "https://images.pexels.com/photos/1/p.jpeg",
    thumb_url: "https://images.pexels.com/photos/1/p-thumb.jpeg",
    subject: "Drain Cleaning",
    source: "pexels",
    pexels_id: 1,
    photographer: "Jane Doe",
    width: 1600,
    height: 1200,
    lead_id: null,
    use_count: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A chainable query stub that records how it was filtered. */
function makeAdmin(result: { data: unknown; error?: unknown } = { data: [] }) {
  const calls: { or?: string; eq?: [string, unknown]; ilike?: [string, string] } = {};
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self,
    or: (v: string) => { calls.or = v; return chain; },
    eq: (a: string, b: unknown) => { calls.eq = [a, b]; return chain; },
    ilike: (a: string, b: string) => { calls.ilike = [a, b]; return chain; },
    order: self,
    limit: async () => result,
    maybeSingle: async () => ({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null }),
    single: async () => ({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error ?? null }),
    insert: self,
    update: self,
  });
  const admin = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  return { admin, calls, chain };
}

describe("searchBuilderImages", () => {
  it("returns stored links for a subject", async () => {
    const { admin, calls } = makeAdmin({ data: [row()] });
    const rows = await searchBuilderImages(admin, { subject: "Drain Cleaning" });
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://images.pexels.com/photos/1/p.jpeg");
    expect(calls.ilike).toEqual(["subject", "%Drain Cleaning%"]);
  });

  it("without a lead, only shared stock links are visible", async () => {
    const { admin, calls } = makeAdmin({ data: [] });
    await searchBuilderImages(admin, {});
    expect(calls.eq).toEqual(["source", "pexels"]);
    expect(calls.or).toBeUndefined();
  });

  it("with a lead, that lead's own photos join the stock links", async () => {
    const { admin, calls } = makeAdmin({ data: [] });
    await searchBuilderImages(admin, { leadId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" });
    expect(calls.or).toBe("source.eq.pexels,lead_id.eq.3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });

  it("a malformed lead id yields NO rows — the fence never widens", async () => {
    const { admin } = makeAdmin({ data: [row()] });
    expect(await searchBuilderImages(admin, { leadId: "not-a-uuid' or true--" })).toEqual([]);
  });

  it("degrades to an empty list when the query errors", async () => {
    const { admin } = makeAdmin({ data: null, error: { message: "boom" } });
    expect(await searchBuilderImages(admin, { subject: "x" })).toEqual([]);
  });
});

describe("recordBuilderImage", () => {
  it("bumps use_count instead of duplicating a link already stored", async () => {
    const existing = row({ use_count: 3 });
    const { admin, chain } = makeAdmin({ data: existing });
    const updateSpy = vi.fn(() => chain);
    (chain as Record<string, unknown>).update = updateSpy;

    await recordBuilderImage(admin, { url: existing.url, source: "pexels", subject: "Drains" });
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ use_count: 4 }));
  });

  it("refuses an empty url outright", async () => {
    const { admin } = makeAdmin();
    expect(await recordBuilderImage(admin, { url: "   ", source: "pexels" })).toBeNull();
  });

  it("never throws — a library outage must not cost a good pick", async () => {
    const admin = {
      from: () => {
        throw new Error("db down");
      },
    } as unknown as SupabaseClient;
    await expect(recordBuilderImage(admin, { url: "https://x.test/a.jpg", source: "pexels" })).resolves.toBeNull();
  });
});
