import { ContentDoc, TemplateManifest } from "./schema";

/** The demo site expressed as a Content Document — powers previews and the verification render. */
export function sampleContentDoc(manifest: TemplateManifest): ContentDoc {
  return {
    identity: { ...manifest.identity },
    theme: {},
    pages: manifest.pages.map((page) => ({
      page_id: page.id,
      title: page.title_sample,
      slots: Object.fromEntries(page.slots.map((s) => [s.id, s.sample])),
      repeats: Object.fromEntries(page.repeats.map((r) => [r.id, r.samples.map((row) => ({ ...row }))])),
    })),
  };
}
