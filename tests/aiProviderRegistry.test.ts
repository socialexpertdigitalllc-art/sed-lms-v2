// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  AI_PROVIDER_REGISTRY,
  AI_TASK_REGISTRY,
  LONG_OUTPUT_TOKENS,
  TEXT_BATCH_TOKENS,
  apiKeyFrom,
  assignmentError,
  capableModelsForTask,
  getModel,
  getProvider,
  getTask,
  hasCompleteCredentials,
  isAiTaskKey,
  isValidAssignment,
  maskCredentialHint,
} from "@/lib/ai-tools/providers/registry";

describe("AI provider registry", () => {
  it("describes exactly the providers we can call", () => {
    expect(AI_PROVIDER_REGISTRY.map((p) => p.key)).toEqual(["gemini", "deepseek", "webcraft", "minimax"]);
  });

  it("only lists OpenAI-compatible chat/completions endpoints", () => {
    // The single call path in lib/ai-tools/run.ts assumes this — a provider
    // with a different wire format needs an adapter, not just a descriptor.
    for (const p of AI_PROVIDER_REGISTRY) {
      expect(p.endpoint).toMatch(/^https:\/\/.+\/chat\/completions$/);
      expect(p.models.length).toBeGreaterThan(0);
      expect(p.credentialFields.length).toBeGreaterThan(0);
      expect(p.envKey).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("keeps the provider capability rollup honest against its models", () => {
    for (const p of AI_PROVIDER_REGISTRY) {
      expect(p.capabilities.vision).toBe(p.models.some((m) => m.vision));
      expect(p.capabilities.maxOutputTokens).toBe(Math.max(...p.models.map((m) => m.maxOutputTokens)));
      expect(p.capabilities.longOutput).toBe(p.capabilities.maxOutputTokens >= LONG_OUTPUT_TOKENS);
    }
  });

  it("marks only the models documented to accept image input as vision", () => {
    // MiniMax publishes image input for MiniMax-M3 alone; DeepSeek and Moonshot
    // publish none for the ids we list. Flagging one wrongly is exactly the
    // silent failure this registry exists to prevent.
    expect(getModel("minimax", "MiniMax-M3")?.vision).toBe(true);
    expect(getModel("minimax", "MiniMax-M2")?.vision).toBe(false);
    expect(AI_PROVIDER_REGISTRY.find((p) => p.key === "deepseek")!.models.every((m) => !m.vision)).toBe(true);
    expect(AI_PROVIDER_REGISTRY.find((p) => p.key === "webcraft")!.models.every((m) => !m.vision)).toBe(true);
  });

  it("resolves providers and models, and rejects unknown ones", () => {
    expect(getProvider("gemini")?.label).toBe("Google Gemini");
    expect(getProvider("nope")).toBeUndefined();
    expect(getModel("gemini", "gemini-3.5-flash")?.vision).toBe(true);
    expect(getModel("gemini", "not-a-model")).toBeUndefined();
  });
});

describe("AI task registry", () => {
  it("describes exactly the seven AI tasks", () => {
    expect(AI_TASK_REGISTRY.map((t) => t.key)).toEqual([
      "content_plan",
      "file_regen",
      "image_vision",
      "legacy_v1",
      "template_compile",
      "content_write",
      "site_build",
    ]);
    expect(isAiTaskKey("file_regen")).toBe(true);
    expect(isAiTaskKey("nope")).toBe(false);
  });

  it("keeps every task's own default a legal assignment", () => {
    for (const t of AI_TASK_REGISTRY) {
      expect(assignmentError(t.key, t.defaultProvider, t.defaultModel)).toBeNull();
    }
  });

  it("states the capability each task actually demands", () => {
    expect(getTask("image_vision")!.requires.vision).toBe(true);
    // The default path sends only a page's TEXT, in ~4000-char batches, so a
    // large output budget is no longer the requirement it was under the old
    // whole-file rewrite.
    expect(getTask("file_regen")!.requires.minOutputTokens).toBe(TEXT_BATCH_TOKENS);
    expect(getTask("content_plan")!.requires.vision).toBe(false);
    // The legacy generator reads its model off the generation row.
    expect(getTask("legacy_v1")!.routable).toBe(false);
  });
});

describe("capability constraints", () => {
  it("refuses a text-only model for image vetting, with a reason", () => {
    // THE constraint. A text-only model here does not error — it answers about
    // photos it never saw, which is indistinguishable from a broken image step.
    const reason = assignmentError("image_vision", "deepseek", "deepseek-chat");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/cannot read them/);
    expect(isValidAssignment("image_vision", "deepseek", "deepseek-chat")).toBe(false);
    expect(isValidAssignment("image_vision", "minimax", "MiniMax-M2")).toBe(false);
    expect(isValidAssignment("image_vision", "minimax", "MiniMax-M3")).toBe(true);
  });

  it("allows a small model for the text rewrite, which only needs a batch's worth", () => {
    // Previously barred: the old path made the model re-emit the ENTIRE file,
    // so 8k truncated a page. The default path never sends markup at all, so a
    // batch answer is ~2k and DeepSeek does the job.
    expect(isValidAssignment("file_regen", "deepseek", "deepseek-chat")).toBe(true);
    expect(isValidAssignment("file_regen", "webcraft", "moonshot-v1-128k")).toBe(true);
  });

  it("keeps the output requirement wired up, just re-based on the batch size", () => {
    // The gate is not switched off — every registered model now clears the new
    // bar, so the guarantee worth pinning is that the threshold is still the
    // one the task declares (the vision test above proves refusal still works).
    const need = getTask("file_regen")!.requires.minOutputTokens;
    expect(need).toBe(TEXT_BATCH_TOKENS);
    for (const p of AI_PROVIDER_REGISTRY) {
      for (const m of p.models) {
        expect(isValidAssignment("file_regen", p.key, m.id)).toBe(m.maxOutputTokens >= need);
      }
    }
  });

  it("allows a small text model for planning, which only needs 8k", () => {
    expect(isValidAssignment("content_plan", "deepseek", "deepseek-chat")).toBe(true);
  });

  it("requires a real long-output ceiling for Site Studio's page writer, not the old 8k test-fixture number", () => {
    // A measured production page (183 text slots) truncated mid-JSON at the
    // old 8000 ceiling every time. Writing now batches large pages, but a
    // single batch — or an atomic repeat too big to split across batches —
    // must still clear real model output. Rebased on LONG_OUTPUT_TOKENS, the
    // same bar file_regen's own whole-page rewrite already uses.
    expect(getTask("content_write")!.requires.minOutputTokens).toBe(LONG_OUTPUT_TOKENS);
    // DeepSeek's 8192-token ceiling is too tight a margin for a ~45-slot
    // batch once a verbose model's hidden reasoning tokens are accounted
    // for (see image_vision's own note on gemini-3.5-flash's ~1,800) — this
    // pairing must now be refused rather than silently truncate.
    expect(isValidAssignment("content_write", "deepseek", "deepseek-chat")).toBe(false);
    expect(isValidAssignment("content_write", "gemini", "gemini-3.1-pro-preview")).toBe(true);
  });

  it("requires a real long-output ceiling for Site Builder's whole-page rewrite", () => {
    // A real template page is ~110KB (~30k tokens) and must come back WHOLE —
    // same bar as content_write, since there is no smaller "just the text"
    // path here (Site Builder sends and returns full markup).
    expect(getTask("site_build")!.requires.minOutputTokens).toBe(LONG_OUTPUT_TOKENS);
    expect(isValidAssignment("site_build", "deepseek", "deepseek-chat")).toBe(false);
    expect(isValidAssignment("site_build", "gemini", "gemini-3.1-pro-preview")).toBe(true);
  });

  it("names unknown tasks, providers and models rather than silently passing", () => {
    expect(assignmentError("nope", "gemini", "gemini-2.5-pro")).toMatch(/Unknown task/);
    expect(assignmentError("content_plan", "nope", "x")).toMatch(/Unknown provider/);
    expect(assignmentError("content_plan", "gemini", "gemini-9")).toMatch(/does not offer/);
  });

  it("offers only capable pairings per task", () => {
    const vision = capableModelsForTask("image_vision");
    expect(vision.length).toBeGreaterThan(0);
    expect(vision.every(({ model }) => model.vision)).toBe(true);
    expect(vision.some(({ provider, model }) => provider.key === "minimax" && model.id === "MiniMax-M3")).toBe(true);

    const regen = capableModelsForTask("file_regen");
    expect(regen.every(({ model }) => model.maxOutputTokens >= TEXT_BATCH_TOKENS)).toBe(true);
    // Now offered: the text-batch path asks for ~2k, not a whole page.
    expect(regen.some(({ provider }) => provider.key === "deepseek")).toBe(true);

    // Every offered pairing is, by definition, one the API would accept.
    for (const task of AI_TASK_REGISTRY) {
      for (const { provider, model } of capableModelsForTask(task.key)) {
        expect(assignmentError(task.key, provider.key, model.id)).toBeNull();
      }
    }
  });
});

describe("credential handling", () => {
  const gemini = getProvider("gemini")!;

  it("requires every declared field", () => {
    expect(hasCompleteCredentials(gemini, null)).toBe(false);
    expect(hasCompleteCredentials(gemini, {})).toBe(false);
    expect(hasCompleteCredentials(gemini, { api_key: "  " })).toBe(false);
    expect(hasCompleteCredentials(gemini, { api_key: "sk-abc" })).toBe(true);
  });

  it("masks a stored key down to its last 4 and never more", () => {
    expect(maskCredentialHint(gemini, { api_key: "sk-live-9F2xQ7ab" })).toBe("••••Q7ab");
    expect(maskCredentialHint(gemini, { api_key: "abc" })).toBe("••••");
    expect(maskCredentialHint(gemini, null)).toBeNull();
    // The hint must never contain the whole secret.
    expect(maskCredentialHint(gemini, { api_key: "sk-live-9F2xQ7ab" })).not.toContain("sk-live");
  });

  it("extracts the bearer key, or null when incomplete", () => {
    expect(apiKeyFrom(gemini, { api_key: " sk-abc " })).toBe("sk-abc");
    expect(apiKeyFrom(gemini, { api_key: "" })).toBeNull();
    expect(apiKeyFrom(gemini, null)).toBeNull();
  });
});
