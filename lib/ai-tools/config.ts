// Shared config for the AI website-generation tools (Phase 4).
// Safe to import from both client and server — contains NO secrets, only the
// name of the env var that holds each provider key (read server-side only).

export type ToolId = "webcraft" | "deepseek" | "gemini";

export interface ToolConfig {
  id: ToolId;
  label: string;
  blurb: string;
  perm: string; // permission key required to use the tool
  analyticsPerm: string; // permission key required to view its analytics
  endpoint: string; // OpenAI-compatible chat/completions endpoint
  envKey: string; // process.env key holding the API key (server only)
  models: string[];
  defaultModel: string;
  maxOutputTokens: number; // provider hard cap on output tokens
  defaultMaxTokens: number;
  costPer1kUsd: number; // rough blended $ per 1k tokens, for cost estimates
  accent: string; // UI accent for the tool
  // An internal tool is a provider used by another subsystem (the Template
  // Engine) rather than a standalone generator, and must not be surfaced as a
  // generator card on /ai-tools. It stays selectable in provider/model pickers.
  internal?: boolean;
}

export const TOOLS: Record<ToolId, ToolConfig> = {
  webcraft: {
    id: "webcraft",
    label: "WebCraft",
    blurb: "Generate a complete multi-page website with Kimi (Moonshot).",
    perm: "ai_tools.webcraft",
    analyticsPerm: "analytics.view_webcraft",
    endpoint: "https://api.moonshot.ai/v1/chat/completions",
    envKey: "KIMI_API_KEY",
    models: [
      "moonshot-v1-128k",
      "kimi-k2-0711-preview",
      "moonshot-v1-32k",
      "moonshot-v1-auto",
    ],
    defaultModel: "moonshot-v1-128k",
    maxOutputTokens: 32000,
    defaultMaxTokens: 16000,
    costPer1kUsd: 0.002,
    accent: "#0D9488",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    blurb: "Generate a complete multi-page website with DeepSeek.",
    perm: "ai_tools.deepseek",
    analyticsPerm: "analytics.view_deepseek",
    endpoint: "https://api.deepseek.com/chat/completions",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
    maxOutputTokens: 8192,
    defaultMaxTokens: 8192,
    costPer1kUsd: 0.0015,
    accent: "#4F46E5",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    blurb: "Content planning and whole-file generation with Google Gemini (Template Engine).",
    perm: "templates.generate",
    analyticsPerm: "analytics.view_templates",
    // OpenAI-compatible surface, so callProvider() works unchanged.
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    envKey: "GEMINI_API_KEY",
    // Ids verified against the live account. NOTE: "gemini-3-pro-preview" 404s
    // on this endpoint despite being listed by /v1beta/models — do not add it.
    models: ["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
    defaultModel: "gemini-3.1-pro-preview",
    // Generous cap: truncated output silently produced no-op edits in v1, and a
    // large page (index.html ~78KB) needs headroom to be reproduced whole without
    // the model shortening it to fit. gemini-3.x pro supports up to 64k output.
    maxOutputTokens: 64000,
    defaultMaxTokens: 32000,
    // Unverified estimate: persisted to cost_usd and aggregated into analytics.
    // Refine when real pricing is confirmed.
    costPer1kUsd: 0.005,
    accent: "#4285F4",
    // Powers the Template Engine; not a standalone generator (no /ai-tools/gemini page).
    internal: true,
  },
};

export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

export function isToolId(v: string): v is ToolId {
  return v === "webcraft" || v === "deepseek" || v === "gemini";
}

// A public tool is a standalone generator: it has an /ai-tools/<id> page and
// its own generate/save endpoints. Internal providers are reachable only via
// the subsystem that owns them, so route handlers must gate on this rather
// than isToolId — otherwise /api/ai-tools/gemini/generate would expose an
// arbitrary-prompt passthrough on our Gemini key.
export function isPublicToolId(v: string): v is ToolId {
  return isToolId(v) && !TOOLS[v].internal;
}

// Named roles so call sites never hard-code model ids.
export const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
export const GEMINI_FLASH_MODEL = "gemini-3.5-flash";
