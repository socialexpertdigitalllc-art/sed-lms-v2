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
}

const currentYear = (): string => String(new Date().getFullYear());

/** Identity copied verbatim from the dossier — never invented, never derived.
 *  Keys the dossier lacks are simply absent (the renderer/schema treat a
 *  missing identity key as "no {{id:*}} reference to it may resolve", which
 *  is the safe default). `year` is always present: it isn't a dossier fact,
 *  it's today's date. */
function seedIdentity(dossier: Dossier): Record<string, string> {
  const identity: Record<string, string> = {};
  if (dossier.business_name) identity.business_name = dossier.business_name;
  if (dossier.phone) identity.phone = dossier.phone;
  if (dossier.phone_href) identity.phone_href = dossier.phone_href;
  if (dossier.email) identity.email = dossier.email;
  if (dossier.logo) identity.logo = dossier.logo;
  if (dossier.map_embed) identity.map_embed = dossier.map_embed;
  if (dossier.profile_link) identity.profile_link = dossier.profile_link;
  identity.year = currentYear();
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
 *  clobbering another. Pure. */
export function seedContentDoc(
  manifest: TemplateManifest,
  dossier: Dossier,
  selectedPages: SelectedPage[],
): SeedResult {
  const pagesById = new Map(manifest.pages.map((p) => [p.id, p]));
  const pending: PendingSlot[] = [];

  const pages: ContentDocPage[] = selectedPages.map((sel) => {
    const def = pagesById.get(sel.page_id);
    if (!def) {
      throw new Error(`seedContentDoc: selected page id "${sel.page_id}" is not in the manifest`);
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
    return page;
  });

  const doc: ContentDoc = {
    identity: seedIdentity(dossier),
    theme: deriveTheme(dossier.color_scheme, manifest.theme),
    pages,
  };

  return { doc, pending };
}
