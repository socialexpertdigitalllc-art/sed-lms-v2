// Shared config for the AI website-generation tools (Phase 4).
// Safe to import from both client and server — contains NO secrets, only the
// name of the env var that holds each provider key (read server-side only).

export type ToolId = "webcraft" | "deepseek";

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
};

export const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

export function isToolId(v: string): v is ToolId {
  return v === "webcraft" || v === "deepseek";
}
