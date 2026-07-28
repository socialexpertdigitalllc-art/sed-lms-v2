import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Site Builder's image library — LINKS, never bytes.
 *
 * Every image on a generated site is referenced by its own public URL: a
 * Pexels CDN link, or the client's own photo link. Nothing is downloaded,
 * nothing is rehosted, and no private-bucket URL ever reaches a page (which
 * is what previously shipped `…/object/sign/…?token=` URLs the model
 * mangled into 400s).
 *
 * This table is the memory of that: a link recorded against the service it
 * was found for, so the same service searched again — or the same photo used
 * for another client — resolves straight to a URL with no second API call.
 *
 * Deliberately separate from `studio_assets` (Site Studio's byte library) —
 * see migration 0060 for why the two must not share a table.
 */

const TABLE = "builder_images";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BuilderImageRow {
  id: string;
  url: string;
  thumb_url: string | null;
  subject: string;
  source: "pexels" | "client_link";
  pexels_id: number | null;
  photographer: string | null;
  width: number;
  height: number;
  lead_id: string | null;
  use_count: number;
  created_at: string;
}

export interface SearchOpts {
  /** Service/topic to match, case-insensitively and as a substring. */
  subject?: string;
  /** When given, this lead's OWN photos are included alongside stock. */
  leadId?: string;
  limit?: number;
}

/**
 * Library lookup for one service. Stock rows are shared; a lead's own photos
 * are visible only to that lead.
 *
 * The lead fence is checked before it is interpolated: a malformed id yields
 * NO ROWS rather than a widened query, so the fence can never be the thing
 * that opens up under bad input (same rule as Site Studio's `searchLibrary`).
 * Never throws — a library outage degrades to "no stored links", and live
 * search still answers.
 */
export async function searchBuilderImages(admin: SupabaseClient, opts: SearchOpts = {}): Promise<BuilderImageRow[]> {
  if (opts.leadId && !UUID_RE.test(opts.leadId)) return [];
  try {
    let query = admin.from(TABLE).select("*");
    query = opts.leadId
      ? query.or(`source.eq.pexels,lead_id.eq.${opts.leadId}`)
      : query.eq("source", "pexels");
    if (opts.subject) query = query.ilike("subject", `%${opts.subject}%`);
    query = query.order("use_count", { ascending: false }).order("created_at", { ascending: false }).limit(opts.limit ?? 60);

    const { data, error } = await query;
    if (error || !data) return [];
    return data as BuilderImageRow[];
  } catch {
    return [];
  }
}

export interface RecordImageInput {
  url: string;
  thumbUrl?: string | null;
  subject?: string;
  source: "pexels" | "client_link";
  pexelsId?: number | null;
  photographer?: string | null;
  width?: number;
  height?: number;
  /** Required for `client_link`, forbidden for `pexels` (DB CHECK enforces). */
  leadId?: string | null;
  createdBy?: string | null;
}

/**
 * Remember a link so it can be reused without searching again. Idempotent by
 * URL: picking the same image twice bumps its use count instead of creating a
 * second row.
 *
 * NEVER THROWS. Recording is bookkeeping — if it fails, the caller still has
 * a perfectly good URL to put on the site, and failing the pick over a
 * library write would be strictly worse than forgetting the link.
 */
export async function recordBuilderImage(
  admin: SupabaseClient,
  input: RecordImageInput,
): Promise<BuilderImageRow | null> {
  const url = input.url.trim();
  if (!url) return null;

  try {
    const { data: existing } = await admin.from(TABLE).select("*").eq("url", url).maybeSingle();
    if (existing) {
      const row = existing as BuilderImageRow;
      // Keep the subject that first found it, but fill one in if it was blank
      // — the same photo genuinely reused for a second service is still best
      // remembered under the service that found it.
      const patch: Record<string, unknown> = { use_count: row.use_count + 1 };
      if (!row.subject && input.subject) patch.subject = input.subject;
      const { data: bumped } = await admin.from(TABLE).update(patch).eq("id", row.id).select().maybeSingle();
      return (bumped as BuilderImageRow) ?? row;
    }

    const { data, error } = await admin
      .from(TABLE)
      .insert({
        url,
        thumb_url: input.thumbUrl ?? null,
        subject: input.subject ?? "",
        source: input.source,
        pexels_id: input.pexelsId ?? null,
        photographer: input.photographer ?? null,
        width: input.width ?? 0,
        height: input.height ?? 0,
        lead_id: input.source === "client_link" ? (input.leadId ?? null) : null,
        use_count: 1,
        created_by: input.createdBy ?? null,
      })
      .select()
      .single();

    if (error) {
      // A concurrent pick of the same photo won the unique index — hand back
      // whichever row is now stored rather than treating a race as a failure.
      if (error.code === "23505") {
        const { data: raced } = await admin.from(TABLE).select("*").eq("url", url).maybeSingle();
        return (raced as BuilderImageRow) ?? null;
      }
      return null;
    }
    return data as BuilderImageRow;
  } catch {
    return null;
  }
}
