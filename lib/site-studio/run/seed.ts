import type { ContentDoc, ContentDocPage, TemplateManifest } from "../schema";
import type { Dossier } from "./dossier";
import type { SelectedPage } from "./pageSelect";
import { deriveTheme } from "./theme";

/** One empty text slot the Writer still needs to fill. */
export interface PendingSlot {
  page_id: string;
  slot_id: string;
}

export interface SeedResult {
  doc: ContentDoc;
  pending: PendingSlot[];
  /** `selectedPages` entries whose `page_id` isn't in the manifest — skipped
   *  rather than thrown. In practice `selectedPages` is always sourced from
   *  `selectPages()` against this same manifest, so this should never be
   *  non-empty; it exists so a short, always-persist-something step never
   *  dies on a caller mismatch instead of reporting it. */
  skipped: string[];
}

const currentYear = (now: Date): string => String(now.getFullYear());

/** Identity copied verbatim from the dossier — never invented, never derived.
 *  Keys the dossier lacks are simply absent, and that is NOT harmless: the
 *  renderer's completeness check refuses the WHOLE site if any compiled
 *  skeleton references an {{id:*}} key the document lacks. That is why the
 *  engine's `prepare` step runs the same check immediately after seeding and
 *  fails the run there, with the missing facts named — catching it before the
 *  writer spends a model call per page, rather than at render afterwards.
 *  Seeding a placeholder instead would be worse: an empty email would ship
 *  `href=""` onto a client's live site. `year` is always present: it isn't a
 *  dossier fact, it's today's date. */
function seedIdentity(dossier: Dossier, now: Date): Record<string, string> {
  const identity: Record<string, string> = {};
  if (dossier.business_name) identity.business_name = dossier.business_name;
  if (dossier.phone) identity.phone = dossier.phone;
  if (dossier.phone_href) identity.phone_href = dossier.phone_href;
  if (dossier.email) identity.email = dossier.email;
  if (dossier.email_href) identity.email_href = dossier.email_href;
  if (dossier.logo) identity.logo = dossier.logo;
  if (dossier.map_embed) identity.map_embed = dossier.map_embed;
  if (dossier.profile_link) identity.profile_link = dossier.profile_link;
  identity.year = currentYear(now);
  return identity;
}

/** Builds the Content Document skeleton the Writer fills in. Identity is
 *  copied verbatim from the dossier (Task rule: identity is NEVER
 *  model-written). Theme is derived deterministically from the dossier's
 *  free-text colour scheme. Every IMAGE slot defaults to the template's own
 *  sample path, so the site renders complete and correct before any curation
 *  exists (3a scope decision — image curation is a Phase 3b/cockpit
 *  activity). Every TEXT slot (and each page's title) starts empty and is
 *  listed in `pending` for the Writer.
 *
 *  `selectedPages` may repeat a `page_id` for a stamped fan-out page (one
 *  entry per service/area, distinguished by `output`); each entry becomes
 *  its own doc-page at its own array index — the doc-page INDEX, not the
 *  page_id, is what makes stamped duplicates addressable without one
 *  clobbering another. A `selectedPages` entry whose `page_id` the manifest
 *  doesn't have is skipped (reported in `skipped`) rather than thrown — this
 *  is a short, always-persist-something step, so a caller mismatch must
 *  degrade to "reported and moved on", never an uncaught exception. `now` is
 *  an injected clock (defaults to the wall clock) so the function stays
 *  genuinely pure/deterministic for callers that need it — e.g. re-running
 *  `prepare` idempotently in a test. */
export function seedContentDoc(
  manifest: TemplateManifest,
  dossier: Dossier,
  selectedPages: SelectedPage[],
  now: Date = new Date(),
): SeedResult {
  const pagesById = new Map(manifest.pages.map((p) => [p.id, p]));
  const pending: PendingSlot[] = [];
  const skipped: string[] = [];

  const pages: ContentDocPage[] = [];
  for (const sel of selectedPages) {
    const def = pagesById.get(sel.page_id);
    if (!def) {
      skipped.push(sel.page_id);
      continue;
    }

    const slots: Record<string, string> = {};
    for (const slot of def.slots) {
      if (slot.type === "image") {
        slots[slot.id] = slot.sample;
      } else {
        slots[slot.id] = "";
        pending.push({ page_id: sel.page_id, slot_id: slot.id });
      }
    }

    const page: ContentDocPage = {
      page_id: sel.page_id,
      title: "",
      slots,
      repeats: {},
    };
    if (sel.output) page.output = sel.output;
    if (sel.nav_title) page.nav_title = sel.nav_title;
    pages.push(page);
  }

  const doc: ContentDoc = {
    identity: seedIdentity(dossier, now),
    theme: deriveTheme(dossier.color_scheme, manifest.theme),
    pages,
  };

  return { doc, pending, skipped };
}

/** One image slot on a "gallery"-kind doc-page a lead's own photo can be
 *  placed into at prepare (Task 2, Phase 4c) — see `gallerySlotTargets`. */
export interface GallerySlotTarget {
  /** The doc-page's array INDEX, not its `page_id` — a stamped fan-out page
   *  can repeat the same `page_id` (mirrors the addressing `applyWritten`
   *  and `SlotImageState` already use for exactly this reason). */
  page_index: number;
  slot_id: string;
  /** Carried through from the manifest slot's own `subject_hint`, when it has
   *  one, so the caller doing the actual rehost (`run/engine.ts`'s
   *  `runPrepare`) can give the placed asset a sensible `subject` without
   *  re-deriving it — omitted (not empty-stringed) when the slot has none. */
  subject_hint?: string;
}

/** Every IMAGE slot, in doc order (page order, then each page's own manifest
 *  slot order), on a doc-page whose manifest `kind` is "gallery" — the exact
 *  set of places a lead's own `client_photos` are placed into at `prepare`,
 *  one photo per slot, in order, until either list runs out (see
 *  `run/engine.ts`'s `runPrepare`, which does the actual rehosting/merging;
 *  this stays a pure, deterministic lookup, same separation
 *  `imageSource.ts`'s `imageSlotQueries` already draws between "what to do"
 *  and "the effectful doing of it"). A template with no gallery-kind page
 *  simply returns an empty list — the caller is responsible for deciding
 *  that means the photos are left for the picker instead. */
export function gallerySlotTargets(manifest: TemplateManifest, doc: ContentDoc): GallerySlotTarget[] {
  const pageDefsById = new Map(manifest.pages.map((p) => [p.id, p]));
  const out: GallerySlotTarget[] = [];

  doc.pages.forEach((docPage, page_index) => {
    const def = pageDefsById.get(docPage.page_id);
    if (!def || def.kind !== "gallery") return;
    for (const slot of def.slots) {
      if (slot.type !== "image") continue;
      out.push({
        page_index,
        slot_id: slot.id,
        ...(slot.subject_hint ? { subject_hint: slot.subject_hint } : {}),
      });
    }
  });

  return out;
}
