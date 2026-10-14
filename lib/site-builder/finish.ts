// lib/site-builder/finish.ts
/**
 * The deterministic finish every Site Builder file gets after the AI writes
 * it — the half of each guarantee that does not depend on the model listening:
 *
 *  - COLOURS: the shared components file's SITE THEME base variables are set
 *    from the lead's colour scheme (palette.ts), whatever the model wrote;
 *  - READABILITY: every page carries the contrast guard (contrastGuard.ts);
 *  - LOGO: every page carries a stylesheet that sizes the lead's logo big in
 *    the header and footer — it was rendering 44px tall on every live site
 *    (2026-10-14), because the prompt itself asked for 44px.
 *
 * Applied where the run's form-relay sweep already runs (run.ts), so a
 * generated page, a carried page and a regenerated page all get it, and the
 * stored page — which the run screen previews — is exactly what deploys.
 * Idempotent: finishing a finished file changes nothing.
 */
import type { BusinessBrief } from "./prompt";
import { assignThemeSlots, buildPalette, describePalette, type BrandPalette, type ThemeSlot } from "./palette";
import { applyThemeValues, parseThemeSlots } from "./siteTheme";
import { CONTRAST_GUARD_ID, contrastGuardTag } from "./contrastGuard";

export interface SiteFinish {
  palette: BrandPalette | null;
  /** The template's marked SITE THEME variables (empty when it has none). */
  slots: ThemeSlot[];
  /** Variable → colour for this lead; null when there is nothing to set. */
  themeValues: Record<string, string> | null;
  /** The lead's logo URL, when it has one. */
  logo: string | null;
  /** The business name — every logo <img> carries it as its alt text. */
  businessName: string;
  /** The template's shared components file, which carries the SITE THEME. */
  componentsFile: string | null;
}

/** What to finish this run's files with — from the lead's brief and the
 *  template's ORIGINAL components file (its SITE THEME markers are the slot
 *  list, whatever the AI later does to them). */
export function planSiteFinish(brief: BusinessBrief, components: { file: string; source: string } | null): SiteFinish {
  const slots = components ? parseThemeSlots(components.source) : [];
  const palette = buildPalette(brief.color_scheme);
  return {
    palette,
    slots,
    themeValues: palette && slots.length ? assignThemeSlots(slots, palette) : null,
    logo: brief.logo?.trim() || null,
    businessName: brief.business_name.trim(),
    componentsFile: components?.file ?? null,
  };
}

/** The brief the prompts see: the colour roles spelled out, so the model
 *  writes pages in the same palette the theme carries. */
export function briefWithPalette(brief: BusinessBrief, finish: SiteFinish): BusinessBrief {
  return finish.palette ? { ...brief, palette: describePalette(finish.palette), theme_set: !!finish.themeValues } : brief;
}

export const LOGO_STYLE_ID = "sb-logo-size";

const cssString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, "")}"`;

/**
 * The logo stylesheet: header logos 80px tall on desktop (56px on phones),
 * footer logos 72px — !important, so neither an inline height the model wrote
 * nor a small template rule can shrink them again. Only logos in the header,
 * navigation and footer, so a deliberately different size elsewhere (a big
 * logo on the About page) is left alone; found by the lead's logo URL, or by
 * the business name as alt text, which every logo <img> carries — a live site
 * had a second logo URL in its header that the lead no longer had.
 */
export function logoStyleTag(logo: string, businessName = ""): string {
  const img = businessName
    ? `:is(img[src=${cssString(logo)}], img[alt=${cssString(businessName)} i])`
    : `img[src=${cssString(logo)}]`;
  return `<style id="${LOGO_STYLE_ID}">
/* SED Site Builder: the client's logo, sized to read at a glance. */
:is(header, nav, app-header, [class*="header"], [id*="header"], [class*="navbar"], [id*="nav"]) ${img} {
  height: clamp(56px, 6vw, 80px) !important; width: auto !important; max-height: none !important;
  max-width: min(320px, 58vw) !important; object-fit: contain !important;
}
:is(footer, app-footer, [class*="footer"], [id*="footer"]) ${img} {
  height: clamp(56px, 5vw, 72px) !important; width: auto !important; max-height: none !important;
  max-width: min(300px, 70vw) !important; object-fit: contain !important;
}
:is([class*="mark"], [class*="badge"]):has(> ${img}) {
  width: auto !important; height: auto !important; background: none !important; padding: 0 !important;
}
</style>`;
}

/** Replace the element with this id, or insert `tag` before </head> (or
 *  </body>), falling back to the end of the document. */
function upsert(html: string, id: string, tag: string, at: "head" | "body"): string {
  const existing = new RegExp(`<(style|script)\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<\\/\\1>`, "i");
  if (existing.test(html)) return html.replace(existing, () => tag);
  if (at === "head") {
    const close = html.search(/<\/head>/i);
    if (close >= 0) return `${html.slice(0, close)}${tag}\n${html.slice(close)}`;
  }
  // The LAST </body>: an earlier one can only be text inside a script.
  const end = html.toLowerCase().lastIndexOf("</body>");
  if (end >= 0) return `${html.slice(0, end)}${tag}\n${html.slice(end)}`;
  return `${html}\n${tag}`;
}

/** `source` of `file`, finished for this site. */
export function finishFile(file: string, source: string, finish: SiteFinish): string {
  let out = source;
  const isComponents = file === finish.componentsFile;
  if (finish.themeValues && (isComponents || parseThemeSlots(out).length)) {
    out = applyThemeValues(out, finish.themeValues, finish.slots);
  }
  // A real page of the site — not the components include, which every page
  // already loads.
  if (!isComponents && /\.html?$/i.test(file) && /<body[\s>]/i.test(out)) {
    if (finish.logo) out = upsert(out, LOGO_STYLE_ID, logoStyleTag(finish.logo, finish.businessName), "head");
    out = upsert(out, CONTRAST_GUARD_ID, contrastGuardTag(), "body");
  }
  return out;
}
