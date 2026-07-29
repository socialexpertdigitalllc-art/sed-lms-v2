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

/**
 * Columns the simulated database does NOT have — a migration that has not been
 * applied yet. Naming one in a `select()` fails the WHOLE query, exactly as
 * PostgREST does, and that is the hazard `readProviderRows` exists to avoid:
 * a column list would error, the caller's catch would swallow it, and every
 * provider would read as unconfigured. Empty means "fully migrated".
 *
 * Reads only. Writes are not simulated as strict, so a test cannot use this to
 * assert what an INSERT of an unknown column does.
 */
const missingColumns = new Set<string>();

/** When set, every query throws — a database outage, which is the ONLY way the
 *  last-resort env-key branch of `resolveTaskModel` is reached. With the DB up,
 *  an env key is seeded into a row instead and the normal path serves it. */
const db = { down: false };

/** PostgREST projects to the requested columns; `*` returns the whole row. */
function project(rows: Row[], cols: string): Row[] {
  if (cols.trim() === "*") return rows.map((r) => ({ ...r }));
  const names = cols.split(",").map((c) => c.trim()).filter(Boolean);
  return rows.map((r) => Object.fromEntries(names.filter((n) => n in r).map((n) => [n, r[n]])));
}

/** The first requested column the simulated DB does not have, if any. */
function absentColumn(cols: string): string | null {
  if (cols.trim() === "*") return null;
  return cols.split(",").map((c) => c.trim()).find((c) => missingColumns.has(c)) ?? null;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (db.down) throw new Error("connection refused");
      const rows = () => (tables[table] ??= []);
      // `select()` is both awaitable (read-all) and chainable (.eq().maybeSingle()),
      // exactly like the supabase-js builder.
      const selectBuilder = (cols = "*") => {
        const absent = absentColumn(cols);
        const fail = { data: null, error: { message: `column "${absent}" does not exist` } };
        return {
          then: (res: (v: { data: Row[] | null; error: unknown }) => unknown) =>
            Promise.resolve(absent ? fail : { data: project(rows(), cols), error: null }).then(res),
          eq: (col: string, val: unknown) => ({
            maybeSingle: () =>
              Promise.resolve(
                absent ? fail : { data: project(rows().filter((r) => r[col] === val), cols)[0] ?? null, error: null },
              ),
          }),
        };
      };
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
  getAiProviderConfigs,
  getAiProviderStatuses,
  resolveTaskModel,
  saveAiProvider,
  saveAiTaskAssignment,
  clearAiTaskAssignment,
} from "@/lib/ai-tools/providers/config";
import { callForTask, clearTaskModelCache } from "@/lib/ai-tools/providers/run";
import { getProvider } from "@/lib/ai-tools/providers/registry";
import { TOOL_IDS } from "@/lib/ai-tools/config";
import { DEFAULT_RATE_BUDGETS } from "@/lib/ai-tools/providers/limits";

function reset() {
  tables.ai_providers = [];
  tables.ai_task_assignments = [];
  missingColumns.clear();
  db.down = false;
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
    // Vision is the hard one: a text-only model here answers about photos it
    // never saw. (file_regen no longer needs a huge budget — the default path
    // sends only text, in batches — so DeepSeek is legitimately allowed there.)
    expect(await saveAiTaskAssignment("image_vision", "deepseek", "deepseek-chat")).toBeNull();
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

/* --------------------------------------------------------- rate budgets */

describe("provider rate limits", () => {
  it("carries a stored budget into the resolved spec", async () => {
    await saveAiProvider("minimax", { enabled: true, credentials: { api_key: "k" }, rateLimits: { rpm: 30 } });
    clearTaskModelCache();

    const resolved = await resolveTaskModel("image_rank");
    expect(resolved.providerKey).toBe("minimax");
    // The bucket is the provider, so the gate pools every model on the account.
    expect(resolved.spec.providerKey).toBe("minimax");
    expect(resolved.spec.rateBudget?.rpm).toBe(30);
    // The override REPLACES one dimension; the shipped default survives on the
    // others, which is what makes this a merge and not a wholesale swap.
    expect(resolved.spec.rateBudget?.tpm).toBe(DEFAULT_RATE_BUDGETS.minimax.tpm);
  });

  it("paces a provider the operator has never touched, from the shipped defaults", async () => {
    await saveAiProvider("gemini", { credentials: { api_key: "g" } });
    const resolved = await resolveTaskModel("content_plan");
    // Not an empty budget: an empty one admits every caller instantly, which is
    // the inert gate this whole subsystem exists to replace.
    expect(resolved.spec.rateBudget).toEqual(DEFAULT_RATE_BUDGETS.gemini);
  });

  it("still paces on the last-resort env-key path, so a DB outage cannot un-pace a provider", async () => {
    // The DB must be genuinely unreachable, not merely empty: an empty table
    // plus an env key gets SEEDED into a row and served by the normal path, so
    // an "empty table" test would never reach the branch it names.
    process.env.GEMINI_API_KEY = "from-env";
    db.down = true;
    const resolved = await resolveTaskModel("content_plan");
    expect(resolved.spec.apiKey).toBe("from-env");
    expect(resolved.spec.providerKey).toBe("gemini");
    expect(resolved.spec.rateBudget).toEqual(DEFAULT_RATE_BUDGETS.gemini);
  });

  it("survives a database that has not been migrated yet", async () => {
    // Simulates the pre-0062 shape: no rate_limits column at all. Selecting a
    // column list that named it would fail the query and read EVERY provider as
    // unconfigured, taking all AI routing down until the migration landed.
    missingColumns.add("rate_limits");
    tables.ai_providers = [
      {
        provider_key: "minimax",
        enabled: true,
        encrypted_credentials: `enc:${Buffer.from(JSON.stringify({ api_key: "k" })).toString("base64")}`,
        updated_at: null,
      },
    ];
    const configs = await getAiProviderConfigs();
    const minimax = configs.find((c) => c.key === "minimax");
    expect(minimax).toBeDefined();
    expect(minimax?.credentials).toEqual({ api_key: "k" });
    expect(minimax?.rateLimits ?? null).toBeNull();

    // ...and routing still works, on the shipped defaults.
    const resolved = await resolveTaskModel("image_rank");
    expect(resolved.providerKey).toBe("minimax");
    expect(resolved.spec.rateBudget).toEqual(DEFAULT_RATE_BUDGETS.minimax);
  });

  it("keeps a stored budget when an unrelated field is saved", async () => {
    await saveAiProvider("minimax", { credentials: { api_key: "k" }, rateLimits: { rpm: 30, tpd: null } });
    // The settings UI toggles `enabled` without resending the limits; reading
    // the existing row with a column list that omitted rate_limits would write
    // null back and silently discard the operator's budget.
    const status = await saveAiProvider("minimax", { enabled: false });
    expect(status?.rateLimits).toEqual({ rpm: 30, tpd: null });
    const config = (await getAiProviderConfigs()).find((c) => c.key === "minimax");
    expect(config?.rateLimits).toEqual({ rpm: 30, tpd: null });
  });

  it("resets to the shipped defaults on an explicit null", async () => {
    await saveAiProvider("minimax", { credentials: { api_key: "k" }, rateLimits: { rpm: 30 } });
    await saveAiProvider("minimax", { rateLimits: null });
    const resolved = await resolveTaskModel("image_rank");
    expect(resolved.spec.rateBudget).toEqual(DEFAULT_RATE_BUDGETS.minimax);
  });

  it("ignores a stored value that is not an object", async () => {
    // The 0062 check constraint forbids this, but resolveBudget's `in` operator
    // THROWS on a scalar, and that throw would be a failed generation.
    await saveAiProvider("minimax", { credentials: { api_key: "k" } });
    tables.ai_providers[0].rate_limits = "oops";
    const resolved = await resolveTaskModel("image_rank");
    expect(resolved.spec.rateBudget).toEqual(DEFAULT_RATE_BUDGETS.minimax);
  });

  it("buckets the legacy env-keyed tools under their registry provider key", () => {
    // `callProvider` (lib/ai-tools/run.ts) tags its spec with the ToolId. If any
    // ToolId were not also a registry key, that tool would gate under a name of
    // its own and one vendor quota would be split across two buckets.
    for (const tool of TOOL_IDS) {
      expect(getProvider(tool), `ToolId "${tool}" has no registry provider`).toBeDefined();
      expect(DEFAULT_RATE_BUDGETS[tool], `ToolId "${tool}" has no shipped budget`).toBeDefined();
    }
  });
});
