import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetRow } from "./types";

export interface SearchLibraryOpts {
  subject?: string;
  leadId?: string;
  kinds?: Array<"stock" | "client">;
  limit?: number;
}

// postgrest-js does ZERO escaping of `.or()` filter strings — it's raw
// PostgREST syntax, split on unquoted commas. A `leadId` that isn't
// strictly a UUID could smuggle in an extra clause (e.g.
// "<uuid>,kind.eq.client") and OR in every client's private photos the
// moment a route exposes `leadId` to a query param. Validating the shape
// HERE, at the one place the fence is built, is what keeps it a fence
// instead of a suggestion.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows this lead is allowed to see: shared stock, plus this lead's OWN client
 *  photos — never another client's. `leadId` absent means stock-only (no
 *  run context, e.g. the standalone library management surface). This is the
 *  client fence (spec §8) and must be enforced here, not upstream.
 *
 *  A malformed `leadId` (anything that isn't a plain UUID) fails CLOSED —
 *  returns no rows at all — rather than falling back to a wider query. The
 *  fence must never be the thing that widens under bad input. */
export async function searchLibrary(admin: SupabaseClient, opts: SearchLibraryOpts = {}): Promise<AssetRow[]> {
  if (opts.leadId && !UUID_RE.test(opts.leadId)) return [];

  let query = admin.from("studio_assets").select("*");
  query = opts.leadId ? query.or(`kind.eq.stock,lead_id.eq.${opts.leadId}`) : query.eq("kind", "stock");
  if (opts.subject) query = query.ilike("subject", `%${opts.subject}%`);
  if (opts.kinds?.length) query = query.in("kind", opts.kinds);
  query = query.order("created_at", { ascending: false }).limit(opts.limit ?? 60);

  const { data, error } = await query;
  if (error || !data) return [];
  return data as AssetRow[];
}

export type NewAssetFields = Partial<Pick<AssetRow, "id" | "use_count">> &
  Omit<AssetRow, "id" | "created_at" | "use_count">;

/** Inserts a new library row. Re-picking a Pexels photo already in the
 *  library (same `pexels_id`) must reuse the stored bytes, not duplicate them
 *  — the unique index on `pexels_id` (migration 0054) surfaces a 23505
 *  conflict, which this resolves by fetching and returning the EXISTING row
 *  instead of erroring. */
export async function insertAsset(admin: SupabaseClient, fields: NewAssetFields): Promise<AssetRow> {
  const { data, error } = await admin.from("studio_assets").insert(fields).select().single();
  if (error) {
    if (error.code === "23505" && fields.pexels_id != null) {
      const { data: existing } = await admin
        .from("studio_assets")
        .select()
        .eq("pexels_id", fields.pexels_id)
        .single();
      if (existing) return existing as AssetRow;
    }
    throw new Error(`insertAsset failed: ${error.message}`);
  }
  if (!data) throw new Error("insertAsset failed: no data returned");
  return data as AssetRow;
}

/** Increments use_count by one. Read-then-write (not an atomic SQL increment)
 *  — acceptable here: use_count is an informational popularity signal shown
 *  in the library UI, never a correctness-critical counter. */
export async function bumpUseCount(admin: SupabaseClient, assetId: string): Promise<void> {
  const { data } = await admin.from("studio_assets").select().eq("id", assetId).single();
  const current = (data as AssetRow | null)?.use_count ?? 0;
  await admin.from("studio_assets").update({ use_count: current + 1 }).eq("id", assetId);
}
