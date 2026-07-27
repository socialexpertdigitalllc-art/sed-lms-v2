export interface AssetRow {
  id: string;
  kind: "stock" | "client";
  lead_id: string | null;
  subject: string;
  niche_tags: string[];
  width: number;
  height: number;
  source: "pexels" | "upload" | "client_link";
  pexels_id: number | null;
  photographer: string | null;
  storage_path: string;
  content_type: string;
  use_count: number;
  created_at: string;
}

/** One option shown to the operator at Gate 1. Library candidates already
 *  live in our bucket; pexels candidates are hot-linked THUMBNAILS ONLY —
 *  nothing is rehosted until a human picks it. */
export type ImageCandidate =
  | { kind: "library"; asset_id: string; thumb_path: string; width: number; height: number; subject: string }
  | { kind: "pexels"; pexels_id: number; thumb_url: string; download_url: string; width: number; height: number; photographer: string };

export type PickChoice =
  | { kind: "library"; asset_id: string }
  | { kind: "pexels"; pexels_id: number; download_url: string; width: number; height: number; photographer: string; subject: string }
  | { kind: "client"; url: string; subject: string };
