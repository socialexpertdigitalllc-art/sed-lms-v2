// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompiledTemplate, ContentDoc, TemplateManifest } from "@/lib/site-studio/schema";
import type { RunContentDoc } from "@/lib/site-studio/run/applyWritten";
import type { StudioRunRow } from "@/lib/site-studio/run/types";
import { finalizeRun, SITES_BUCKET, zipPathFor } from "@/lib/site-studio/run/finalize";
import { savePackage } from "@/lib/site-studio/service/templates";
import { unzipToMap } from "@/lib/site-studio/zip";
import { emptyFakeAdminState, makeFakeAdmin, type FakeAdminState } from "./helpers/fakeStudioAdmin";

/**
 * BLOCKER 1 (Phase 4b): `content`, `revert`, `theme`, `reroll`, and `images`
 * each refused an operator's edit once a run reached "ready" — the exact
 * status Gate 2 (`RunPreview`/`ThemePanel`) requires before it even mounts —
 * because each route checked `isTerminal(status)` (which includes "ready")
 * instead of the new `isEditable(status)` predicate (`reviewing` or
 * `ready`). These tests exercise the ACTUAL route handlers (not just the
 * predicate in isolation) end to end, proving the fix reaches the HTTP
 * boundary the operator's browser actually calls — the bug survived exactly
 * because no earlier test crossed that boundary (component tests mock
 * `fetch`; the E2E test calls the pure engine functions directly).
 *
 * `guard()` is mocked to always authorize (auth/permissions are exercised
 * elsewhere); `createAdminClient()` is mocked to return this file's
 * `fakeStudioAdmin`, the same in-memory Supabase stand-in
 * `siteStudioEngine.test.ts`/`siteStudioDeployRun.test.ts` already use.
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

import { PATCH as contentPatch } from "@/app/api/site-studio/runs/[id]/content/route";
import { POST as revertPost } from "@/app/api/site-studio/runs/[id]/revert/route";
import { PATCH as themePatch } from "@/app/api/site-studio/runs/[id]/theme/route";
import { POST as rerollPost } from "@/app/api/site-studio/runs/[id]/reroll/route";
import { POST as imagesPost } from "@/app/api/site-studio/runs/[id]/images/route";

const NOW = "2026-07-01T00:00:00.000Z";
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

function jsonReq(method: string, body: unknown): Request {
  return new Request("http://test.local/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DEAD_OR_MIDFLIGHT = ["failed", "cancelled", "preparing"] as const;

describe("PATCH /content — isEditable, not isTerminal", () => {
  function docWithSlot(value: string): ContentDoc {
    return {
      identity: {},
      theme: {},
      pages: [{ page_id: "index", title: "Home", slots: { hero: value }, repeats: {} }],
    };
  }

  for (const status of ["reviewing", "ready"] as const) {
    it(`accepts an edit while the run is "${status}"`, async () => {
      const { state } = setup();
      state.runs["run-1"] = freshRow({ status, content_doc: docWithSlot("original") }) as unknown as Record<string, unknown>;

      const res = await contentPatch(jsonReq("PATCH", { page_index: 0, slots: { hero: "edited" } }), ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.content_doc.pages[0].slots.hero).toBe("edited");
    });
  }

  for (const status of DEAD_OR_MIDFLIGHT) {
    it(`refuses an edit while the run is "${status}"`, async () => {
      const { state } = setup();
      state.runs["run-1"] = freshRow({ status, content_doc: docWithSlot("original") }) as unknown as Record<string, unknown>;

      const res = await contentPatch(jsonReq("PATCH", { page_index: 0, slots: { hero: "edited" } }), ctx);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toMatch(new RegExp(status));
    });
  }

  /**
   * BLOCKER 1, part B: a Gate 2 edit must actually reach the deployed site —
   * `finalize` writes `zip_path` once, BEFORE any Gate 2 editing, so without
   * a re-finalize the deployed/downloadable zip would silently keep serving
   * pre-edit bytes. This proves the fix: an edit at "ready" changes the
   * STORED zip's bytes (not just `content_doc`).
   */
  it("an edit at 'ready' re-finalizes and changes the stored zip's bytes", async () => {
    const { state, admin } = setup();

    const manifest: TemplateManifest = {
      engine: 3, name: "gate2-zip-test", version: 1,
      identity: {},
      theme: { mode: "none", roles: {} },
      nav: [],
      pages: [
        {
          id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
          slots: [{ id: "hero", type: "text", sample: "Hero", max_chars: 60, html: false }],
          repeats: [],
        },
      ],
    };
    const compiled: CompiledTemplate = {
      manifest,
      pages: { "index.html": `<html><head><title>{{title}}</title></head><body><h1>{{slot:hero}}</h1></body></html>` },
      fragments: {},
      assets: {},
    };
    await savePackage(admin, "tpl-1", compiled);
    state.templates["tpl-1"] = { manifest };

    const originalDoc: ContentDoc = {
      identity: {},
      theme: {},
      pages: [{ page_id: "index", output: "index.html", title: "Home", slots: { hero: "Original hero copy" }, repeats: {} }],
    };

    // Seed the zip exactly as `finalize` would have left it BEFORE any Gate 2
    // edit — this is the artifact the bug left stale.
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

    const res = await contentPatch(
      jsonReq("PATCH", { page_index: 0, slots: { hero: "Edited hero copy" } }),
      ctx,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.warning).toBeUndefined();

    const newBytes = state.storage[`${SITES_BUCKET}/${zipPathFor("run-1")}`]!;
    expect(newBytes).toBeTruthy();
    expect(newBytes).not.toEqual(oldBytes);

    const files = unzipToMap(newBytes);
    const html = new TextDecoder().decode(files["index.html"]);
    expect(html).toContain("Edited hero copy");
    expect(html).not.toContain("Original hero copy");
  });
});

describe("POST /revert — isEditable, not isTerminal", () => {
  function docWithOperatorTitle(): RunContentDoc {
    return {
      identity: {},
      theme: {},
      pages: [{ page_id: "index", title: "Operator-edited title", slots: {}, repeats: {} }],
      provenance: [
        { title: { written_by: "operator" }, slots: {}, repeats: {}, ai_backup: { title: "AI title", slots: {} } },
      ],
    };
  }

  for (const status of ["reviewing", "ready"] as const) {
    it(`accepts a revert while the run is "${status}"`, async () => {
      const { state } = setup();
      state.runs["run-1"] = freshRow({ status, content_doc: docWithOperatorTitle() }) as unknown as Record<string, unknown>;

      const res = await revertPost(jsonReq("POST", { page_index: 0, title: true }), ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.content_doc.pages[0].title).toBe("AI title");
    });
  }

  for (const status of DEAD_OR_MIDFLIGHT) {
    it(`refuses a revert while the run is "${status}"`, async () => {
      const { state } = setup();
      state.runs["run-1"] = freshRow({ status, content_doc: docWithOperatorTitle() }) as unknown as Record<string, unknown>;

      const res = await revertPost(jsonReq("POST", { page_index: 0, title: true }), ctx);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toMatch(new RegExp(status));
    });
  }
});

describe("PATCH /theme — isEditable, not isTerminal", () => {
  const manifest: TemplateManifest = {
    engine: 3, name: "gate2-theme-test", version: 1,
    identity: {},
    theme: { mode: "css_vars", roles: { brand: { hex: "#000000" } } },
    nav: [],
    pages: [{ id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home", slots: [], repeats: [] }],
  };
  function doc(): ContentDoc {
    return { identity: {}, theme: { brand: "#000000" }, pages: [{ page_id: "index", title: "Home", slots: {}, repeats: {} }] };
  }

  for (const status of ["reviewing", "ready"] as const) {
    it(`accepts a theme edit while the run is "${status}"`, async () => {
      const { state } = setup();
      state.templates["tpl-1"] = { manifest };
      state.runs["run-1"] = freshRow({ status, content_doc: doc() }) as unknown as Record<string, unknown>;

      const res = await themePatch(jsonReq("PATCH", { roles: { brand: "#123456" } }), ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.content_doc.theme.brand).toBe("#123456");
    });
  }

  for (const status of DEAD_OR_MIDFLIGHT) {
    it(`refuses a theme edit while the run is "${status}"`, async () => {
      const { state } = setup();
      state.templates["tpl-1"] = { manifest };
      state.runs["run-1"] = freshRow({ status, content_doc: doc() }) as unknown as Record<string, unknown>;

      const res = await themePatch(jsonReq("PATCH", { roles: { brand: "#123456" } }), ctx);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toMatch(new RegExp(status));
    });
  }
});

describe("POST /reroll — isEditable, not the old 'reviewing'-only gate", () => {
  function doc(): ContentDoc {
    return { identity: {}, theme: {}, pages: [{ page_id: "index", title: "Home", slots: {}, repeats: {} }] };
  }

  // `lead_id: null` short-circuits AFTER the status gate (route: "This run
  // has no lead") — proving the gate itself let the request through without
  // needing a full template/lead/AI-call setup.
  for (const status of ["reviewing", "ready"] as const) {
    it(`passes the gate (does not 409) while the run is "${status}"`, async () => {
      const { state } = setup();
      state.runs["run-1"] = freshRow({ status, content_doc: doc(), lead_id: null }) as unknown as Record<string, unknown>;

      const res = await rerollPost(jsonReq("POST", { page_index: 0 }), ctx);
      const body = await res.json();

      expect(res.status).not.toBe(409);
      expect(body.error).toMatch(/no lead/i);
    });
  }

  for (const status of DEAD_OR_MIDFLIGHT) {
    it(`refuses to re-roll while the run is "${status}"`, async () => {
      const { state } = setup();
      state.runs["run-1"] = freshRow({ status, content_doc: doc(), lead_id: null }) as unknown as Record<string, unknown>;

      const res = await rerollPost(jsonReq("POST", { page_index: 0 }), ctx);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toMatch(new RegExp(status));
    });
  }
});

describe("POST /images — isEditable, not the old 'reviewing'-only gate", () => {
  const manifest: TemplateManifest = {
    engine: 3, name: "gate2-images-test", version: 1,
    identity: {},
    theme: { mode: "none", roles: {} },
    nav: [],
    pages: [
      {
        id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
        slots: [{ id: "hero_img", type: "image", sample: "img/hero.jpg", html: false }],
        repeats: [],
      },
    ],
  };
  function doc(): ContentDoc {
    return {
      identity: {},
      theme: {},
      pages: [{ page_id: "index", title: "Home", slots: { hero_img: "img/hero.jpg" }, repeats: {} }],
    };
  }
  function seedCommon(state: FakeAdminState, status: StudioRunRow["status"]) {
    state.templates["tpl-1"] = { manifest };
    state.studio_assets["asset-1"] = { id: "asset-1", kind: "stock", lead_id: null, use_count: 0 };
    state.runs["run-1"] = freshRow({
      status,
      content_doc: doc(),
      steps: { images: { slots: { "0:hero_img": { query: "hero", candidates: [], sourced_at: NOW } } } },
    }) as unknown as Record<string, unknown>;
  }

  for (const status of ["reviewing", "ready"] as const) {
    it(`accepts a pick while the run is "${status}"`, async () => {
      const { state } = setup();
      seedCommon(state, status);

      const res = await imagesPost(
        jsonReq("POST", { key: "0:hero_img", choice: { kind: "library", asset_id: "asset-1" } }),
        ctx,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.run.content_doc.pages[0].slots.hero_img).toBe("asset:asset-1");
    });
  }

  for (const status of DEAD_OR_MIDFLIGHT) {
    it(`refuses a pick while the run is "${status}"`, async () => {
      const { state } = setup();
      seedCommon(state, status);

      const res = await imagesPost(
        jsonReq("POST", { key: "0:hero_img", choice: { kind: "library", asset_id: "asset-1" } }),
        ctx,
      );
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.error).toMatch(new RegExp(status));
    });
  }
});
