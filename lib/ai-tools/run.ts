import { createAdminClient } from "@/lib/supabase/admin";
import { TOOLS, isToolId, type ToolId } from "./config";
import { countImages, countWords, parseFiles, type GeneratedFile } from "./parse";
import { getWgeConfig } from "./wge";
import { mapLeadToInput } from "./leadPrefill";
import { buildPrompt, EMPTY_INPUT, type GenInput } from "./prompt";

const BUCKET = "ai-generations";

export interface PersistInput {
  tool: ToolId;
  agentId: string | null;
  leadId?: string | null;
  businessName?: string | null;
  model: string;
  files: GeneratedFile[];
  tokensUsed?: number | null;
  totalTimeMs?: number | null;
  inputTimeMs?: number | null;
  aiTimeMs?: number | null;
  pageTypes?: string[];
  numPages?: number | null;
  status?: "success" | "failed";
  errors?: string | null;
}

// Insert the ai_generations row, upload each file to private Storage, finalise.
export async function persistGeneration(input: PersistInput): Promise<{ id: string; uploaded: string[] }> {
  const cfg = TOOLS[input.tool];
  const admin = createAdminClient();

  const tokens = input.tokensUsed ?? 0;
  const numPages = input.numPages ?? input.files.length;
  const wordCount = countWords(input.files);
  const imageCount = countImages(input.files);
  const cost = Number(((tokens / 1000) * cfg.costPer1kUsd).toFixed(6));
  const complexity = Number((numPages * 10 + imageCount * 2 + tokens / 100).toFixed(2));

  const { data: row, error: insErr } = await admin
    .from("ai_generations")
    .insert({
      tool: input.tool,
      agent_id: input.agentId,
      lead_id: input.leadId ?? null,
      business_name: input.businessName ?? null,
      model: input.model,
      total_time_ms: input.totalTimeMs ?? null,
      input_time_ms: input.inputTimeMs ?? null,
      ai_time_ms: input.aiTimeMs ?? null,
      num_pages: numPages,
      num_files: input.files.length,
      page_types: input.pageTypes ?? input.files.map((f) => f.name),
      tokens_used: tokens,
      cost_usd: cost,
      status: input.status ?? "success",
      word_count: wordCount,
      image_count: imageCount,
      complexity_score: complexity,
      errors: input.errors ?? null,
    })
    .select("id")
    .single();
  if (insErr || !row) throw new Error(insErr?.message ?? "Save failed");

  const uploaded: string[] = [];
  for (const f of input.files) {
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(`${row.id}/${f.name}`, new Blob([f.code], { type: "text/html" }), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });
    if (!upErr) uploaded.push(f.name);
  }

  await admin.from("ai_generations").update({ file_path: `${row.id}/` }).eq("id", row.id);
  return { id: row.id, uploaded };
}

// Non-streamed OpenAI-compatible chat completion. Returns { text, tokens }.
// `opts.images`, when present and non-empty, sends the user turn as a
// multimodal content array (one text part + one image_url part per url) —
// verified against Gemini's OpenAI-compat endpoint for vision ranking
// (lib/template-engine/vision.ts). Every existing caller omits `images`, so
// `userContent` stays the same plain string as before — this is additive only.
// Hard ceiling on any single provider call. A hung/stalled connection (Gemini
// commonly stalls when its vision endpoint is rate-limited) must ABORT, not
// hang forever — a hang can't be retried because it never throws, and it was
// what wedged the image step for 30-40 minutes. Callers may pass a tighter
// `timeoutMs` (vision does); big whole-file regens keep the generous default.
const DEFAULT_CALL_TIMEOUT_MS = 300000; // 5 min

export async function callProvider(
  tool: ToolId,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens: number; temperature: number; images?: string[]; timeoutMs?: number }
): Promise<{ text: string; tokens: number }> {
  const cfg = TOOLS[tool];
  const apiKey = process.env[cfg.envKey];
  if (!apiKey) throw new Error(`${cfg.label} is not configured (missing ${cfg.envKey}).`);
  return callWithProvider(
    { label: cfg.label, endpoint: cfg.endpoint, apiKey, maxOutputTokens: cfg.maxOutputTokens },
    model,
    systemPrompt,
    userPrompt,
    opts
  );
}

/**
 * The provider spec `callWithProvider` needs: everything about WHERE to send a
 * completion and WITH WHAT, resolved by the caller. Env-configured tools get
 * one built from TOOLS above; per-task routing (lib/ai-tools/providers) builds
 * one from the registry descriptor plus the operator's stored credentials.
 *
 * `apiKey` is a live secret — never log this object.
 */
export interface ProviderSpec {
  label: string;
  endpoint: string;
  apiKey: string;
  /** Hard ceiling for this model; the request sends min(maxTokens, this). */
  maxOutputTokens: number;
}

/**
 * The actual OpenAI-compatible call. Identical wire format for every provider
 * we support (Gemini's compat surface, DeepSeek, Moonshot, MiniMax), which is
 * why adding a provider is a descriptor and nothing else.
 */
export async function callWithProvider(
  cfg: ProviderSpec,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens: number; temperature: number; images?: string[]; timeoutMs?: number }
): Promise<{ text: string; tokens: number }> {
  const userContent =
    opts.images && opts.images.length > 0
      ? [{ type: "text", text: userPrompt }, ...opts.images.map((url) => ({ type: "image_url", image_url: { url } }))]
      : userPrompt;

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: Math.min(opts.maxTokens, cfg.maxOutputTokens),
        temperature: opts.temperature,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`${cfg.label} call timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const j = await res.json();
  const text: string = j?.choices?.[0]?.message?.content ?? "";
  const tokens: number = j?.usage?.total_tokens ?? Math.ceil(text.length / 4);
  return { text, tokens };
}

// Headlessly generate a lead's website end-to-end. Throws on failure.
export async function runGenerationForLead(
  leadId: string,
  engine: { tool: ToolId; model: string },
  enqueuedBy: string | null
): Promise<{ generationId: string }> {
  if (!isToolId(engine.tool)) throw new Error(`Unknown engine tool: ${engine.tool}`);
  // Service role: this runs headlessly (processor has no user session), so
  // load the lead bypassing RLS.
  const admin = createAdminClient();
  const { data: lead } = await admin.from("leads").select("*").eq("id", leadId).is("deleted_at", null).single();
  if (!lead) throw new Error("Lead not found");

  const config = await getWgeConfig();
  const values: GenInput = { ...EMPTY_INPUT, ...mapLeadToInput(lead, config.variables) };
  const userPrompt = buildPrompt(values, config.prompt_template);

  const start = Date.now();
  const { text, tokens } = await callProvider(engine.tool, engine.model, config.system_prompt, userPrompt, {
    maxTokens: config.settings.max_tokens,
    temperature: config.settings.temperature,
  });
  const aiMs = Date.now() - start;

  const files = parseFiles(text);
  if (!files.length) throw new Error("The model returned no usable HTML.");

  const { id } = await persistGeneration({
    tool: engine.tool,
    agentId: (lead.agent_id as string | null) ?? enqueuedBy,
    leadId,
    businessName: lead.business_name as string,
    model: engine.model,
    files,
    tokensUsed: tokens,
    totalTimeMs: aiMs,
    aiTimeMs: aiMs,
    status: "success",
  });
  return { generationId: id };
}
