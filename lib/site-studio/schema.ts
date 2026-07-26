import { z } from "zod";

export type FileMap = Record<string, Uint8Array>;

export interface Diagnostic {
  level: "blocker" | "warn" | "info";
  code: string;
  message: string;
  page?: string;
}

export const PAGE_KINDS = [
  "home", "about", "services_hub", "service", "areas_hub", "area",
  "contact", "gallery", "reviews", "generic",
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

const KIND_PATTERNS: [RegExp, PageKind][] = [
  [/^index\./, "home"],
  [/about/, "about"],
  [/contact/, "contact"],
  [/gallery|portfolio|project/, "gallery"],
  [/review|testimonial/, "reviews"],
  [/area|location|cities/, "areas_hub"],
  [/service/, "services_hub"],
];

export function pageKindFromFilename(file: string): PageKind {
  const base = file.toLowerCase();
  for (const [re, kind] of KIND_PATTERNS) if (re.test(base)) return kind;
  return "generic";
}

/**
 * Content values may not contain structural token syntax. Identity tokens
 * ({{id:*}}) ARE allowed — samples carry them by construction and the renderer
 * resolves identity last, so an operator can even type {{id:phone}} on purpose.
 */
const tokenFree = (s: string) => !/\{\{(?!id:)/.test(s) && !s.includes("<!--@");

export const slotDefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "image"]),
  sample: z.string(),
  max_chars: z.number().int().positive().optional(),
  html: z.boolean().default(false),
  semantic: z.string().optional(),
  subject_hint: z.string().optional(),
  aspect: z.string().optional(),
});
export type SlotDef = z.infer<typeof slotDefSchema>;

export const repeatDefSchema = z.object({
  id: z.string().min(1),
  fragment: z.string().min(1),
  min: z.number().int().min(0),
  max: z.number().int().min(1),
  slots: z.array(slotDefSchema),
  samples: z.array(z.record(z.string(), z.string())),
}).refine((r) => r.max >= r.min, "max must be >= min");
export type RepeatDef = z.infer<typeof repeatDefSchema>;

export const pageDefSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  kind: z.enum(PAGE_KINDS),
  stampable: z.boolean(),
  title_sample: z.string(),
  slots: z.array(slotDefSchema),
  repeats: z.array(repeatDefSchema),
});
export type PageDef = z.infer<typeof pageDefSchema>;

export const navRegionSchema = z.object({
  id: z.string().min(1),
  fragment: z.string().min(1),
  location: z.enum(["header", "footer", "mobile"]),
  items: z.array(z.object({
    page_id: z.string().nullable(),
    href: z.string(),
    label: z.string(),
  })).optional(),
});
export type NavRegionDef = z.infer<typeof navRegionSchema>;

// Exported so anything validating a hex value OUTSIDE a full ContentDoc parse
// (e.g. the theme route's PATCH body, app/api/site-studio/runs/[id]/theme)
// checks against this SAME regex rather than drifting from it.
export const hexColor = z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);

export const themeDefSchema = z.object({
  mode: z.enum(["css_vars", "literal_remap", "none"]),
  roles: z.record(z.string(), z.object({ var: z.string().optional(), hex: hexColor })),
});
export type ThemeDef = z.infer<typeof themeDefSchema>;

export const manifestSchema = z.object({
  engine: z.literal(3),
  name: z.string().min(1),
  version: z.number().int().min(1),
  identity: z.record(z.string(), z.string()),
  theme: themeDefSchema,
  nav: z.array(navRegionSchema),
  pages: z.array(pageDefSchema).min(1),
}).superRefine((m, ctx) => {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const p of m.pages) {
    if (ids.has(p.id)) ctx.addIssue({ code: "custom", message: "duplicate page id", path: ["pages"] });
    ids.add(p.id);
    if (files.has(p.file)) ctx.addIssue({ code: "custom", message: "duplicate page file", path: ["pages"] });
    files.add(p.file);
  }
});
export type TemplateManifest = z.infer<typeof manifestSchema>;

/** A compiled template: manifest + tokenized skeletons + fragments + untouched assets. */
export interface CompiledTemplate {
  manifest: TemplateManifest;
  pages: Record<string, string>;
  fragments: Record<string, string>;
  assets: FileMap;
}

export const contentDocPageSchema = z.object({
  page_id: z.string().min(1),
  output: z.string().refine(
    (p) => /^[A-Za-z0-9][A-Za-z0-9/_.-]*\.html$/.test(p) && !p.includes("..") && !p.startsWith("/"),
  ).optional(),
  nav_title: z.string().optional(),
  title: z.string().refine(tokenFree),
  slots: z.record(z.string(), z.string().refine(tokenFree)),
  repeats: z.record(z.string(), z.array(z.record(z.string(), z.string().refine(tokenFree)))).default({}),
});
export type ContentDocPage = z.infer<typeof contentDocPageSchema>;

export const contentDocSchema = z.object({
  identity: z.record(z.string(), z.string().refine(tokenFree)),
  theme: z.record(z.string(), hexColor),
  pages: z.array(contentDocPageSchema).min(1),
});
export type ContentDoc = z.infer<typeof contentDocSchema>;

// {{id:*}} tokens in values resolve at render time; presence of a token is not
// proof of resolution — renderer verifies referenced identity keys exist.
export type RenderResult =
  | { ok: true; files: FileMap }
  | { ok: false; missing: { page_id: string; slot_id: string }[] };
