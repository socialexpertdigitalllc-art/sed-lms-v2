import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplateManifest, ContentDoc } from "../schema";
import type { Dossier } from "./dossier";
import type { SlotImageState } from "./types";
import type { ImageCandidate } from "../assets/types";
import type { PexelsResult } from "../assets/pexels";
import { searchLibrary } from "../assets/library";

export interface SlotQuery {
  key: string;
  page_id: string;
  slot_id: string;
  query: string;
}

// A stem that's nothing but a camera/screenshot's auto-generated counter
// ("IMG_4032", "DSC00123", "Screenshot123") or pure digits carries zero
// actual subject information — searching Pexels for "img 4032" finds
// nothing useful. Contributing "" here just means the query falls back to
// the trade noun alone (`[subject, trade].filter(Boolean)`), which is
// strictly better than polluting it with camera-dump noise.
const GARBAGE_STEM_RE = /^(img|dsc|image|screenshot)[\s_-]*\d*$/i;
const PURE_DIGITS_RE = /^\d+$/;

/** `img/team-photo.jpg` -> "team photo": the basename, minus extension, with
 *  separators turned into spaces. This is the fallback subject when the
 *  template's slot carries no `subject_hint`. Query/fragment are stripped
 *  first (a CDN cache-buster like `?w=1200` is not part of the subject);
 *  `data:` URIs and camera/screenshot auto-names contribute nothing (see
 *  GARBAGE_STEM_RE above) — both degrade to the trade noun alone rather than
 *  polluting the search with noise. */
function subjectFromSample(sample: string): string {
  const withoutQueryOrFragment = sample.split(/[?#]/)[0];
  if (/^data:/i.test(withoutQueryOrFragment.trim())) return "";

  const base = withoutQueryOrFragment.split("/").pop() ?? withoutQueryOrFragment;
  const stem = base.replace(/\.[a-zA-Z0-9]+$/, "");
  if (!stem) return "";
  if (PURE_DIGITS_RE.test(stem) || GARBAGE_STEM_RE.test(stem)) return "";

  return stem.replace(/[-_]+/g, " ").trim().toLowerCase();
}

/** The client's own trade noun, taken verbatim from what they told us —
 *  `site_type` if the lead supplied one, else the FIRST service phrase as
 *  written. Deliberately never a guessed/mapped trade taxonomy (e.g. "Drain
 *  Cleaning" -> "plumbing"): the client stated their trade in their own
 *  words, and image search should search for exactly that. */
function tradeNoun(dossier: Dossier): string {
  const siteType = dossier.site_type?.trim();
  if (siteType) return siteType.toLowerCase();
  return (dossier.services[0] ?? "").trim().toLowerCase();
}

/**
 * Pure core: decides WHAT to search for, one entry per image slot in the
 * doc's pages (text slots are never included — the Writer already ignores
 * them for the same reason). Deterministic: same manifest/doc/dossier always
 * produce the same queries, in doc order. `key` is `${docPageIndex}:${slotId}`
 * — the same format `SlotImageState` and every downstream consumer (engine,
 * routes, UI) key off.
 */
export function imageSlotQueries(manifest: TemplateManifest, doc: ContentDoc, dossier: Dossier): SlotQuery[] {
  const pageDefsById = new Map(manifest.pages.map((p) => [p.id, p]));
  const trade = tradeNoun(dossier);
  const out: SlotQuery[] = [];

  doc.pages.forEach((docPage, index) => {
    const pageDef = pageDefsById.get(docPage.page_id);
    if (!pageDef) return;
    for (const slot of pageDef.slots) {
      if (slot.type !== "image") continue;
      const subject = slot.subject_hint?.trim() || subjectFromSample(slot.sample);
      const query = [subject, trade].filter(Boolean).join(" ").trim();
      out.push({ key: `${index}:${slot.id}`, page_id: docPage.page_id, slot_id: slot.id, query });
    }
  });

  return out;
}

export interface SourceImagesDeps {
  admin: SupabaseClient;
  searchPexels: (query: string) => Promise<PexelsResult>;
  /** Diagnostic hook — sourcing degrading to library-only on a Pexels outage
   *  is worth a line in the run's event log, but only once per call, not once
   *  per slot (a Pexels outage would otherwise flood the log with an
   *  identical warning for every image slot in the page set). */
  log?: (level: "warn", message: string) => void;
}

const LIBRARY_TOPUP_THRESHOLD = 4;
const CANDIDATE_CAP = 9;
const MIN_WIDTH = 1200;
const MIN_HEIGHT = 800;

/**
 * The effectful wrapper: gathers candidates for every image slot the write
 * phase needs. Library first (already rehosted, zero risk), Pexels top-up
 * only when the library falls short — and ONLY cheap, dimension-based
 * filtering (no vision AI anywhere in this path, per spec). Sourcing is an
 * enhancement to the run, never a cause of its failure: a Pexels outage (or
 * any other failure) degrades to fewer candidates, never to a thrown error or
 * a missing slot key.
 */
export async function sourceImages(
  deps: SourceImagesDeps,
  manifest: TemplateManifest,
  doc: ContentDoc,
  dossier: Dossier,
  leadId: string | null,
): Promise<Record<string, SlotImageState>> {
  const queries = imageSlotQueries(manifest, doc, dossier);
  const sourcedAt = new Date().toISOString();
  const result: Record<string, SlotImageState> = {};

  const entriesByQuery = new Map<string, SlotQuery[]>();
  for (const q of queries) {
    const list = entriesByQuery.get(q.query);
    if (list) list.push(q);
    else entriesByQuery.set(q.query, [q]);
  }

  const seenPexelsIds = new Set<number>();
  let warnedPexelsFailure = false;

  for (const [query, entries] of entriesByQuery) {
    let candidates: ImageCandidate[] = [];
    try {
      const libraryRows = await searchLibrary(deps.admin, { subject: query, leadId: leadId ?? undefined });
      candidates = libraryRows.map((r) => ({
        kind: "library" as const,
        asset_id: r.id,
        thumb_path: r.storage_path,
        width: r.width,
        height: r.height,
        subject: r.subject,
      }));
    } catch {
      candidates = [];
    }

    if (candidates.length < LIBRARY_TOPUP_THRESHOLD) {
      let pexelsResult: PexelsResult;
      try {
        pexelsResult = await deps.searchPexels(query);
      } catch (e) {
        pexelsResult = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (pexelsResult.ok) {
        for (const p of pexelsResult.candidates) {
          if (candidates.length >= CANDIDATE_CAP) break;
          if (p.width < MIN_WIDTH || p.height < MIN_HEIGHT) continue;
          if (seenPexelsIds.has(p.pexels_id)) continue;
          seenPexelsIds.add(p.pexels_id);
          candidates.push(p);
        }
      } else if (!warnedPexelsFailure) {
        deps.log?.("warn", `image sourcing: Pexels search failed (${pexelsResult.error}); continuing library-only`);
        warnedPexelsFailure = true;
      }
    }

    if (candidates.length > CANDIDATE_CAP) candidates = candidates.slice(0, CANDIDATE_CAP);

    for (const entry of entries) {
      result[entry.key] = { query, candidates, sourced_at: sourcedAt };
    }
  }

  return result;
}
