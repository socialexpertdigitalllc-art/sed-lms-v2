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
  [/service/, "services_hub"],
  [/area|location|cities/, "areas_hub"],
  [/contact/, "contact"],
  [/gallery|portfolio|project/, "gallery"],
  [/review|testimonial/, "reviews"],
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
});
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
});
export type NavRegionDef = z.infer<typeof navRegionSchema>;

export const themeDefSchema = z.object({
  mode: z.enum(["css_vars", "literal_remap", "none"]),
  roles: z.record(z.string(), z.object({ var: z.string().optional(), hex: z.string() })),
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
  output: z.string().optional(),
  nav_title: z.string().optional(),
  title: z.string().refine(tokenFree),
  slots: z.record(z.string(), z.string().refine(tokenFree)),
  repeats: z.record(z.string(), z.array(z.record(z.string(), z.string().refine(tokenFree)))).default({}),
});
export type ContentDocPage = z.infer<typeof contentDocPageSchema>;

export const contentDocSchema = z.object({
  identity: z.record(z.string(), z.string().refine(tokenFree)),
  theme: z.record(z.string(), z.string()),
  pages: z.array(contentDocPageSchema).min(1),
});
export type ContentDoc = z.infer<typeof contentDocSchema>;

export type RenderResult =
  | { ok: true; files: FileMap }
  | { ok: false; missing: { page_id: string; slot_id: string }[] };
