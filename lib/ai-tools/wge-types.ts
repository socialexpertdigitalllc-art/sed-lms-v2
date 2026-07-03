import type { ToolId } from "./config";

export type WgeVarType = "text" | "textarea" | "number" | "list";

export interface WgeVariable {
  key: string;          // referenced in the template as {{key}}
  label: string;        // shown in the generator form + WGE editor
  type: WgeVarType;
  fallback: string;     // used when empty (inline {{key|...}} overrides this)
  lead_column: string | null; // source column on `leads`, or null (no auto-map)
  join: string;         // for list types from array columns: ", " or "\n"
}

export interface WgeSettings {
  max_tokens: number;
  temperature: number;
  default_pages: number;
  auto_download: boolean;
  // --- stored now, consumed by WGE-2 ---
  auto_generate: boolean;
  auto_engine: { provider: ToolId; model: string } | null;
  ready_required: string[]; // variable keys required before auto-queue
}

export interface WgeConfig {
  system_prompt: string;
  prompt_template: string;
  variables: WgeVariable[];
  settings: WgeSettings;
}
