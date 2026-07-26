// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompiledTemplate, ContentDoc, TemplateManifest } from "@/lib/site-studio/schema";
import type { StudioRunRow } from "@/lib/site-studio/run/types";
import type { AiCall } from "@/lib/site-studio/run/writer";
import { finalizeRun, SITES_BUCKET, zipPathFor } from "@/lib/site-studio/run/finalize";
import { savePackage } from "@/lib/site-studio/service/templates";
import { runStep, type RunStepDeps } from "@/lib/site-studio/run/engine";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { unzipToMap } from "@/lib/site-studio/zip";
import { emptyFakeAdminState, makeFakeAdmin, type FakeAdminState } from "./helpers/fakeStudioAdmin";

/**
 * Phase 4b: `PATCH /api/site-studio/runs/[id]/identity` is how an operator
 * fills in (or explicitly skips) an identity fact the lead's dossier
 * couldn't supply — the replacement for the old behavior of failing the
 * whole run at `prepare` (see siteStudioEngine.test.ts's retargeted case for
 * that). Same mocking discipline as siteStudioGate2Routes.test.ts: `guard()`
 * always authorizes, `createAdminClient()` returns the in-memory fake admin.
 */

const adminHolder = vi.hoisted(() => ({ admin: null as unknown as SupabaseClient }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminHolder.admin,
}));

vi.mock("@/lib/site-studio/service/guard", () => ({
  guard: async () => ({ userId: "user-1" }),
  guardError: (status: 401 | 403) =>
    NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status }),
}));

import { PATCH as identityPatch } from "@/app/api/site-studio/runs/[id]/identity/route";

const NOW = "2026-07-27T00:00:00.000Z";
const ctx = { params: Promise.resolve({ id: "run-1" }) };

function freshRow(overrides: Partial<StudioRunRow> = {}): StudioRunRow {
  return {
    id: "run-1",
    lead_id: null,
    template_id: "tpl-1",
    template_version: 1,
    status: "reviewing",
    options: {},
    content_doc: null,
    steps: {},
    client_photos: [],
    site_slug: null,
    zip_path: null,
    deployed_url: null,
    error: null,
    paused: false,
    created_by: "user-1",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function setup(): { state: FakeAdminState; admin: SupabaseClient } {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  adminHolder.admin = admin;
  return { state, admin };
}

function jsonReq(body: unknown): Request {
  return new Request("http://test.local/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DEAD_OR_MIDFLIGHT = ["failed", "cancelled", "preparing"] as const;

function docWithIdentity(identity: Record<string, string>): ContentDoc {
  return {
    identity,
    theme: {},
    pages: [{ page_id: "index", title: "Home", slots: {}, repeats: {} }],
  };
}

describe("PATCH /identity — isEditable, not isTerminal", () => {
  for (const status of ["reviewing", "ready"] as const) {
    it(`accepts a fill while the run is "${status}"`, async () => {
      const { state } = setup();
      state.runs["run-1"] = freshRow({
        status,
        content_doc: docWithIdentity({ business_name: "Acme", neighborhood: "" }),
      }) as unknown as Record<string, unknown>;

      const res = await identityPatch(jsonReq({ identity: { neighborhood: "Riverside" } }), ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.content_doc.identity.neighborhood).toBe("Riverside");
    });
  }

  for (const status of DEAD_OR_MIDFLIGHT) {
    it(`refuses a fill while the run is "${status}"`, async () => {
      const { state } = setup();
      state.runs["run-1"] = freshRow({
        status,
        content_doc: docWithIdentity({ business_name: "Acme", neighborhood: "" }),
      }) as unknown as Record<string, unknown>;

      const res = await identityPatch(jsonReq({ identity: { neighborhood: "Riverside" } }), ctx);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toMatch(new RegExp(status));
    });
  }
});

describe("PATCH /identity — validation", () => {
  it("rejects an unknown identity key with 422 (only keys already in content_doc.identity may be set)", async () => {
    const { state } = setup();
    state.runs["run-1"] = freshRow({
      content_doc: docWithIdentity({ business_name: "Acme" }),
    }) as unknown as Record<string, unknown>;

    const res = await identityPatch(jsonReq({ identity: { instagram_handle: "@acme" } }), ctx);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/instagram_handle/);
  });

  it("rejects a non-string value with 422", async () => {
    const { state } = setup();
    state.runs["run-1"] = freshRow({
      content_doc: docWithIdentity({ business_name: "Acme", neighborhood: "" }),
    }) as unknown as Record<string, unknown>;

    const res = await identityPatch(jsonReq({ identity: { neighborhood: 42 } }), ctx);
    expect(res.status).toBe(422);
  });

  it("rejects markup/token/URL content for a non-URL identity key", async () => {
    const { state } = setup();
    state.runs["run-1"] = freshRow({
      content_doc: docWithIdentity({ business_name: "Acme", neighborhood: "" }),
    }) as unknown as Record<string, unknown>;

    const res = await identityPatch(jsonReq({ identity: { neighborhood: "<b>Riverside</b>" } }), ctx);
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.error).toMatch(/neighborhood/);
  });

  it("rejects a bare URL for a non-URL identity key", async () => {
    const { state } = setup();
    state.runs["run-1"] = freshRow({
      content_doc: docWithIdentity({ business_name: "Acme" }),
    }) as unknown as Record<string, unknown>;

    const res = await identityPatch(jsonReq({ identity: { business_name: "https://evil.example.com" } }), ctx);
    expect(res.status).toBe(422);
  });

  it.each(["logo", "map_embed", "profile_link", "phone_href", "email_href"])(
    "allows a URL value for the exempt key \"%s\"",
    async (key) => {
      const { state } = setup();
      state.runs["run-1"] = freshRow({
        content_doc: docWithIdentity({ business_name: "Acme", [key]: "" }),
      }) as unknown as Record<string, unknown>;

      const res = await identityPatch(jsonReq({ identity: { [key]: "https://example.com/thing" } }), ctx);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.run.content_doc.identity[key]).toBe("https://example.com/thing");
    },
  );

  it("rejects an empty identity object with 422", async () => {
    const { state } = setup();
    state.runs["run-1"] = freshRow({ content_doc: docWithIdentity({ business_name: "Acme" }) }) as unknown as Record<string, unknown>;

    const res = await identityPatch(jsonReq({ identity: {} }), ctx);
    expect(res.status).toBe(422);
  });
});

describe("PATCH /identity — CAS on updated_at", () => {
  it("refuses with 409 and the standard wording when the row changed since it was read", async () => {
    const { state, admin } = setup();
    state.runs["run-1"] = freshRow({
      content_doc: docWithIdentity({ business_name: "Acme", neighborhood: "" }),
    }) as unknown as Record<string, unknown>;

    // Deterministically simulate "another writer landed between this
    // request's initial read and its own CAS'd write" (same class of race
    // the concurrent-claim engine test documents as flaky to drive via a
    // real Promise.all): intercept the route's OWN initial fetch and, the
    // instant it resolves, bump `updated_at` in the underlying store — so
    // the token the route captured is now stale by the time its `.update()`
    // checks it.
    const originalFrom = admin.from.bind(admin);
    (admin as unknown as { from: typeof admin.from }).from = ((table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder = originalFrom(table) as any;
      if (table !== "studio_runs") return builder;
      const originalSelect = builder.select.bind(builder);
      builder.select = (...args: unknown[]) => {
        const sel = originalSelect(...args);
        const originalEq = sel.eq.bind(sel);
        sel.eq = (col: string, val: unknown) => {
          const eqBuilder = originalEq(col, val);
          const originalSingle = eqBuilder.single.bind(eqBuilder);
          eqBuilder.single = async () => {
            const result = await originalSingle();
            state.runs["run-1"] = { ...state.runs["run-1"], updated_at: "2026-07-27T00:05:00.000Z" };
            return result;
          };
          return eqBuilder;
        };
        return sel;
      };
      return builder;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const res = await identityPatch(jsonReq({ identity: { neighborhood: "Riverside" } }), ctx);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe("This run changed while you were editing — your view has been refreshed, please redo that change");
  });
});

describe("PATCH /identity — Gate 2 re-finalize", () => {
  it("a fill at 'ready' re-finalizes and changes the stored zip's bytes", async () => {
    const { state, admin } = setup();

    const manifest: TemplateManifest = {
      engine: 3, name: "identity-zip-test", version: 1,
      identity: {}, theme: { mode: "none", roles: {} }, nav: [],
      pages: [{
        id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
        slots: [], repeats: [],
      }],
    };
    const compiled: CompiledTemplate = {
      manifest,
      pages: { "index.html": `<html><head><title>{{title}}</title></head><body><p>{{id:neighborhood}}</p></body></html>` },
      fragments: {},
      assets: {},
    };
    await savePackage(admin, "tpl-1", compiled);
    state.templates["tpl-1"] = { manifest };

    const originalDoc: ContentDoc = {
      identity: { neighborhood: "" },
      theme: {},
      pages: [{ page_id: "index", output: "index.html", title: "Home", slots: {}, repeats: {} }],
    };

    const baseline = await finalizeRun(admin, compiled, originalDoc, "run-1");
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const oldBytes = state.storage[`${SITES_BUCKET}/${zipPathFor("run-1")}`]!;
    expect(oldBytes).toBeTruthy();

    state.runs["run-1"] = freshRow({
      status: "ready",
      content_doc: originalDoc,
      zip_path: baseline.zipPath,
    }) as unknown as Record<string, unknown>;

    const res = await identityPatch(jsonReq({ identity: { neighborhood: "Riverside" } }), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.warning).toBeUndefined();

    const newBytes = state.storage[`${SITES_BUCKET}/${zipPathFor("run-1")}`]!;
    expect(newBytes).not.toEqual(oldBytes);
    const files = unzipToMap(newBytes);
    expect(new TextDecoder().decode(files["index.html"])).toContain("Riverside");
  });
});

// ===========================================================================
// End-to-end: a template referencing identity facts beyond the lead's fixed
// dossier (city/neighborhood — the exact AI-invented-key scenario this whole
// feature exists for) reaches Gate 1 with both listed as pending; filling one
// and skipping the other still renders a complete site with the skipped one
// blank. Driven through the REAL engine (`runStep`), then the REAL route
// handler for the fill/skip, exactly like a cockpit session would.
// ===========================================================================

const identityManifest: TemplateManifest = {
  engine: 3, name: "identity-e2e", version: 1,
  identity: {}, theme: { mode: "none", roles: {} }, nav: [],
  pages: [
    {
      id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
      slots: [{ id: "index_s1", type: "text", sample: "Welcome", max_chars: 60, html: false }],
      repeats: [],
    },
    {
      id: "about", file: "about.html", kind: "about", stampable: false, title_sample: "About",
      slots: [{ id: "about_s1", type: "text", sample: "Our story", max_chars: 60, html: false }],
      repeats: [],
    },
  ],
};
const identityCompiled: CompiledTemplate = {
  manifest: identityManifest,
  pages: {
    "index.html": `<html><head><title>{{title}}</title></head><body><h1>{{slot:index_s1}}</h1><p>Serving {{id:neighborhood}} in {{id:city}}</p></body></html>`,
    "about.html": `<html><head><title>{{title}}</title></head><body><p>{{slot:about_s1}}</p></body></html>`,
  },
  fragments: {},
  assets: {},
};

const identityWriter: AiCall = async (_system, user) => {
  const slots: Record<string, string> = {};
  for (const m of user.matchAll(/^- (\S+).*\| sample: "/gm)) slots[m[1]] = `Custom copy for ${m[1]}`;
  const pageMatch = user.match(/PAGE: (\S+)/);
  return { text: JSON.stringify({ title: `Title for ${pageMatch?.[1] ?? "page"}`, slots, repeats: {} }) };
};

async function seedIdentityAdmin(): Promise<{ state: FakeAdminState; admin: SupabaseClient }> {
  const state = emptyFakeAdminState();
  const admin = makeFakeAdmin(state);
  await savePackage(admin, "tpl-city", identityCompiled);
  state.templates["tpl-city"] = { manifest: identityManifest };
  state.leads["lead-city"] = { id: "lead-city", business_name: "Sparse Co", business_phone: "(303) 555-0000" };
  const row: StudioRunRow = {
    id: "run-city", lead_id: "lead-city", template_id: "tpl-city", template_version: 1,
    status: "queued", options: {}, content_doc: null, steps: {}, client_photos: [],
    site_slug: null, zip_path: null, deployed_url: null, error: null, paused: false,
    created_by: null, created_at: NOW, updated_at: NOW,
  };
  state.runs["run-city"] = row as unknown as Record<string, unknown>;
  return { state, admin };
}

describe("Phase 4b acceptance — pending identity fill/skip reaches a complete site", () => {
  it("reaches Gate 1 with city/neighborhood pending; filling city and skipping neighborhood still renders, with neighborhood blank", async () => {
    const { state, admin } = await seedIdentityAdmin();
    adminHolder.admin = admin;
    const deps: RunStepDeps = { aiCall: identityWriter, now: () => new Date(NOW) };

    let row = state.runs["run-city"] as unknown as StudioRunRow;
    row = (await runStep(admin, row, deps)).row; // prepare
    expect(row.status).toBe("preparing");
    expect(row.steps.prepare?.pending_identity).toEqual(["city", "neighborhood"]);
    expect(row.content_doc?.identity.city).toBe("");
    expect(row.content_doc?.identity.neighborhood).toBe("");

    row = (await runStep(admin, row, deps)).row; // write -> parks at the gate
    expect(row.status).toBe("reviewing");
    expect(row.steps.prepare?.pending_identity).toEqual(["city", "neighborhood"]);

    // ---- Gate 1: operator fills "city", explicitly skips "neighborhood" ----
    const ctxRunCity = { params: Promise.resolve({ id: "run-city" }) };
    const fillRes = await identityPatch(
      new Request("http://test.local/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: { city: "Denver" } }),
      }),
      ctxRunCity,
    );
    const fillBody = await fillRes.json();
    expect(fillRes.status).toBe(200);
    expect(fillBody.run.content_doc.identity.city).toBe("Denver");
    expect(fillBody.run.content_doc.identity.neighborhood).toBe(""); // left blank, by choice
    row = fillBody.run as StudioRunRow;

    // An unknown key is still rejected, even mid Gate-1 session.
    const badRes = await identityPatch(
      new Request("http://test.local/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: { made_up_key: "x" } }),
      }),
      ctxRunCity,
    );
    expect(badRes.status).toBe(422);

    // ---- approve (CAS reviewing -> approved, same shape as the real route) ----
    {
      const { data: approved, error } = await admin
        .from("studio_runs")
        .update({ status: "approved", updated_at: "2026-07-27T00:10:00.000Z" })
        .eq("id", row.id)
        .eq("status", "reviewing")
        .select("*")
        .single();
      expect(error).toBeNull();
      row = approved as unknown as StudioRunRow;
    }

    row = (await runStep(admin, row, deps)).row; // render
    expect(row.status).toBe("rendering");
    row = (await runStep(admin, row, deps)).row; // finalize
    expect(row.status).toBe("ready");
    expect(row.zip_path).toBeTruthy();

    // The finished, deployable site: the filled fact is present, the skipped
    // one is simply blank — no refusal, no leftover token.
    const zipBytes = state.storage[`studio-sites/${row.zip_path}`];
    const files = unzipToMap(zipBytes!);
    const indexHtml = new TextDecoder().decode(files["index.html"]);
    expect(indexHtml).toContain("Serving  in Denver"); // neighborhood blank, city filled
    expect(indexHtml).not.toMatch(/\{\{|<!--@/);

    // Cross-check with a direct render, too.
    const rendered = renderSite(identityCompiled, row.content_doc!);
    expect(rendered.ok).toBe(true);
  });
});
