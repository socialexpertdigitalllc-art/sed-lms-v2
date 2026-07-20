// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fallback resolution: a routing misconfiguration must never break a website
 * generation. Everything below asserts that a broken assignment degrades to the
 * task's registry default (today's Gemini behaviour) instead of throwing.
 *
 * The DB and the crypto helpers are stubbed; the registry and the router are
 * real, so these exercise the actual decision logic.
 */

/* ------------------------------------------------------------ fake tables */

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { ai_providers: [], ai_task_assignments: [] };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const rows = () => (tables[table] ??= []);
      // `select()` is both awaitable (read-all) and chainable (.eq().maybeSingle()),
      // exactly like the supabase-js builder.
      const selectBuilder = () => ({
        then: (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res),
        eq: (col: string, val: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: rows().find((r) => r[col] === val) ?? null, error: null }),
        }),
      });
      const api = {
        select: selectBuilder,
        upsert: (payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
          const pk = table === "ai_providers" ? "provider_key" : "task_key";
          for (const r of Array.isArray(payload) ? payload : [payload]) {
            const i = rows().findIndex((x) => x[pk] === r[pk]);
            if (i === -1) rows().push({ ...r });
            else if (!opts?.ignoreDuplicates) rows()[i] = { ...rows()[i], ...r };
          }
          return Promise.resolve({ error: null });
        },
        delete: () => ({
          eq: (col: string, val: unknown) => {
            tables[table] = rows().filter((r) => r[col] !== val);
            return Promise.resolve({ error: null });
          },
        }),
        eq: (col: string, val: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: rows().find((r) => r[col] === val) ?? null, error: null }),
        }),
      };
      return api;
    },
  }),
}));

// Reversible stand-in for AES-GCM so the tests need no key material.
vi.mock("@/lib/mail/crypto", () => ({
  encryptSecret: (plain: string) => `enc:${Buffer.from(plain, "utf8").toString("base64")}`,
  decryptSecret: (payload: string) => {
    if (!payload.startsWith("enc:")) throw new Error("Malformed ciphertext");
    return Buffer.from(payload.slice(4), "base64").toString("utf8");
  },
}));

const callWithProvider = vi.fn();
vi.mock("@/lib/ai-tools/run", () => ({ callWithProvider: (...a: unknown[]) => callWithProvider(...a) }));

import {
  credentialsFromEnv,
  getAiProviderStatuses,
  resolveTaskModel,
  saveAiProvider,
  saveAiTaskAssignment,
  clearAiTaskAssignment,
} from "@/lib/ai-tools/providers/config";
import { callForTask, clearTaskModelCache } from "@/lib/ai-tools/providers/run";
import { getProvider } from "@/lib/ai-tools/providers/registry";

function reset() {
  tables.ai_providers = [];
  tables.ai_task_assignments = [];
  clearTaskModelCache();
  callWithProvider.mockReset();
  delete process.env.GEMINI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.KIMI_API_KEY;
  delete process.env.MINIMAX_API_KEY;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  reset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

/* ---------------------------------------------------------------- seeding */

describe("env seeding", () => {
  it("reads a provider's single key from its declared env var", () => {
    const gemini = getProvider("gemini")!;
    expect(credentialsFromEnv(gemini, { GEMINI_API_KEY: " g-key " })).toEqual({ api_key: "g-key" });
    expect(credentialsFromEnv(gemini, {})).toBeNull();
    expect(credentialsFromEnv(gemini, { GEMINI_API_KEY: "   " })).toBeNull();
  });

  it("seeds a row on first read so an existing deployment keeps working", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    const statuses = await getAiProviderStatuses();
    expect(statuses.find((s) => s.key === "gemini")).toMatchObject({ enabled: true, configured: true });
    expect(tables.ai_providers).toHaveLength(1);
  });

  it("never clobbers a row the operator edited", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "typed-by-hand" }, enabled: false });
    process.env.GEMINI_API_KEY = "from-env";
    const statuses = await getAiProviderStatuses();
    expect(statuses.find((s) => s.key === "gemini")).toMatchObject({ enabled: false, hint: "••••hand" });
  });

  it("never returns a credential, only configured + a masked hint", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "sk-secret-1234" } });
    const status = (await getAiProviderStatuses()).find((s) => s.key === "gemini")!;
    expect(JSON.stringify(status)).not.toContain("sk-secret");
    expect(status.hint).toBe("••••1234");
  });
});

/* ------------------------------------------------------------- resolution */

describe("resolveTaskModel", () => {
  it("runs the registry default when nothing is assigned", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    const r = await resolveTaskModel("file_regen");
    expect(r).toMatchObject({ providerKey: "gemini", model: "gemini-3.1-pro-preview", usedFallback: false });
    expect(r.spec.maxOutputTokens).toBe(64000);
  });

  it("uses a valid, configured assignment", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    await saveAiProvider("webcraft", { credentials: { api_key: "k" } });
    await saveAiTaskAssignment("file_regen", "webcraft", "moonshot-v1-128k");
    const r = await resolveTaskModel("file_regen");
    expect(r).toMatchObject({ providerKey: "webcraft", model: "moonshot-v1-128k", usedFallback: false });
    // The output ceiling comes from the model descriptor, not a constant.
    expect(r.spec.maxOutputTokens).toBe(32000);
  });

  it("falls back to the default when the assigned provider has no key", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    await saveAiTaskAssignment("content_plan", "deepseek", "deepseek-chat");
    const r = await resolveTaskModel("content_plan");
    expect(r).toMatchObject({ providerKey: "gemini", model: "gemini-3.1-pro-preview", usedFallback: true });
    expect(r.fallbackReason).toMatch(/no stored credentials/);
  });

  it("falls back to the default when the assigned provider is disabled", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    await saveAiProvider("deepseek", { credentials: { api_key: "d" }, enabled: false });
    await saveAiTaskAssignment("content_plan", "deepseek", "deepseek-chat");
    const r = await resolveTaskModel("content_plan");
    expect(r).toMatchObject({ providerKey: "gemini", usedFallback: true });
    expect(r.fallbackReason).toMatch(/disabled/);
  });

  it("ignores a stored row whose pairing the registry no longer allows", async () => {
    // Written before a requirement tightened, or straight into the DB. Running
    // a text-only model on image vetting is the silent failure we refuse.
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    await saveAiProvider("deepseek", { credentials: { api_key: "d" } });
    tables.ai_task_assignments.push({ task_key: "image_vision", provider_key: "deepseek", model: "deepseek-chat", updated_at: null });
    const r = await resolveTaskModel("image_vision");
    expect(r).toMatchObject({ providerKey: "gemini", model: "gemini-3.5-flash" });
  });

  it("refuses to write an impossible assignment in the first place", async () => {
    expect(await saveAiTaskAssignment("image_vision", "deepseek", "deepseek-chat")).toBeNull();
    expect(await saveAiTaskAssignment("file_regen", "deepseek", "deepseek-chat")).toBeNull();
    expect(tables.ai_task_assignments).toHaveLength(0);
  });

  it("ignores an assignment on a task that picks its model per generation", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    await saveAiProvider("webcraft", { credentials: { api_key: "k" } });
    tables.ai_task_assignments.push({ task_key: "legacy_v1", provider_key: "webcraft", model: "moonshot-v1-128k", updated_at: null });
    const r = await resolveTaskModel("legacy_v1");
    expect(r.providerKey).toBe("gemini");
  });

  it("clearing an assignment returns the task to its default", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    await saveAiProvider("webcraft", { credentials: { api_key: "k" } });
    await saveAiTaskAssignment("file_regen", "webcraft", "moonshot-v1-128k");
    await clearAiTaskAssignment("file_regen");
    expect((await resolveTaskModel("file_regen")).providerKey).toBe("gemini");
  });

  it("falls back to the default provider's env key when the DB has no row at all", async () => {
    process.env.GEMINI_API_KEY = "from-env";
    tables.ai_providers = [];
    const r = await resolveTaskModel("content_plan");
    expect(r).toMatchObject({ providerKey: "gemini" });
  });

  it("throws the same not-configured error as before when nothing is available", async () => {
    await expect(resolveTaskModel("content_plan")).rejects.toThrow(/not configured/);
  });
});

/* ----------------------------------------------------------- callForTask */

describe("callForTask", () => {
  it("sends the resolved model and reports what answered", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    callWithProvider.mockResolvedValue({ text: "hi", tokens: 5 });
    const out = await callForTask("content_plan", "sys", "user", { maxTokens: 100, temperature: 0.5 });
    expect(out).toMatchObject({ text: "hi", providerKey: "gemini", model: "gemini-3.1-pro-preview" });
    expect(callWithProvider.mock.calls[0][1]).toBe("gemini-3.1-pro-preview");
  });

  it('resolves "model-max" to the routed model\'s own output ceiling', async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    await saveAiProvider("webcraft", { credentials: { api_key: "k" } });
    await saveAiTaskAssignment("file_regen", "webcraft", "moonshot-v1-128k");
    callWithProvider.mockResolvedValue({ text: "x", tokens: 1 });
    await callForTask("file_regen", "sys", "user", { maxTokens: "model-max", temperature: 0.15 });
    expect(callWithProvider.mock.calls[0][4].maxTokens).toBe(32000);
  });

  it("retries once on the default when the assigned provider throws", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    await saveAiProvider("webcraft", { credentials: { api_key: "k" } });
    await saveAiTaskAssignment("file_regen", "webcraft", "moonshot-v1-128k");
    callWithProvider.mockRejectedValueOnce(new Error("HTTP 500")).mockResolvedValueOnce({ text: "ok", tokens: 2 });
    const out = await callForTask("file_regen", "sys", "user", { maxTokens: 100, temperature: 0 });
    expect(out).toMatchObject({ text: "ok", providerKey: "gemini" });
    expect(callWithProvider).toHaveBeenCalledTimes(2);
  });

  it("does NOT double-call when the default itself is what failed", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    callWithProvider.mockRejectedValue(new Error("HTTP 500"));
    await expect(callForTask("content_plan", "sys", "user", { maxTokens: 10, temperature: 0 })).rejects.toThrow("HTTP 500");
    expect(callWithProvider).toHaveBeenCalledTimes(1);
  });

  it("never lets a credential reach the caller's result", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "sk-secret-1234" } });
    callWithProvider.mockResolvedValue({ text: "hi", tokens: 1 });
    const out = await callForTask("content_plan", "sys", "user", { maxTokens: 10, temperature: 0 });
    expect(JSON.stringify(out)).not.toContain("sk-secret");
  });
});
