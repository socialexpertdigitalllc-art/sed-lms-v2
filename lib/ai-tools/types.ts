import type { ToolId } from "./config";

// A row from public.ai_generations (Phase 4).
export interface AiGeneration {
  id: string;
  tool: ToolId;
  agent_id: string | null;
  lead_id: string | null;
  business_name: string | null;
  model: string | null;
  total_time_ms: number | null;
  input_time_ms: number | null;
  ai_time_ms: number | null;
  num_pages: number | null;
  num_files: number | null;
  page_types: string[] | null;
  tokens_used: number | null;
  cost_usd: number | null;
  status: string | null;
  word_count: number | null;
  image_count: number | null;
  pexels_count: number | null;
  complexity_score: number | null;
  errors: string | null;
  file_path: string | null;
  created_at: string;
}

// Joined with the generating agent's display name (for tables).
export interface AiGenerationRow extends AiGeneration {
  agent?: { display_name: string | null } | null;
}
