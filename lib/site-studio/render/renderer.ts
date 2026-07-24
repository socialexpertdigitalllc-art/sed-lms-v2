import { CompiledTemplate, ContentDoc, ContentDocPage, FileMap, RenderResult } from "../schema";
import { escapeHtml, findTokens, navMarker, repeatMarker, sanitizeInline, NAV_HREF, NAV_TITLE } from "../tokens";
import { applyTheme } from "./theme";

// Plain text-node escaping: & < > only. Slot values land inside element text
// content (not attributes), so quotes/apostrophes need no escaping there —
// unlike tokens.ts's escapeHtml, which also escapes them for attribute-safety
// and is used elsewhere in this file for identity/title/attribute contexts.
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fillSlot = (value: string, sample: string, html: boolean): string =>
  html ? (value === sample ? value : sanitizeInline(value)) : escapeText(value);

/** Depth-aware relative prefix: "services/sewer.html" links back up with "../". */
const relPrefix = (from: string) => "../".repeat(from.split("/").length - 1);

export function renderSite(tpl: CompiledTemplate, doc: ContentDoc): RenderResult {
  const missing: { page_id: string; slot_id: string }[] = [];
  const defs = new Map(tpl.manifest.pages.map((p) => [p.id, p]));

  // completeness: pages + slots + repeat bounds
  const built: { def: any; page: ContentDocPage; output: string }[] = [];
  for (const page of doc.pages) {
    const def = defs.get(page.page_id);
    if (!def) { missing.push({ page_id: page.page_id, slot_id: "(unknown page)" }); continue; }
    for (const s of def.slots) if (!(s.id in page.slots)) missing.push({ page_id: page.page_id, slot_id: s.id });
    for (const r of def.repeats) {
      const rows = page.repeats[r.id] ?? [];
      if (rows.length < r.min) missing.push({ page_id: page.page_id, slot_id: `${r.id} (needs ≥${r.min} rows)` });
      for (const row of rows) for (const s of r.slots) if (!(s.id in row)) missing.push({ page_id: page.page_id, slot_id: s.id });
    }
    built.push({ def, page, output: page.output ?? def.file });
  }

  // completeness: identity keys the skeletons actually reference
  const referenced = new Set(
    Object.values(tpl.pages).concat(Object.values(tpl.fragments))
      .flatMap((html) => findTokens(html)).filter((t) => t.kind === "id").map((t) => t.key),
  );
  for (const key of referenced) if (!(key in doc.identity)) missing.push({ page_id: "(site)", slot_id: `id:${key}` });

  if (missing.length > 0) return { ok: false, missing };

  const navItems = built.filter((b) => !b.def.stampable)
    .map((b) => ({ href: b.output, title: b.page.nav_title ?? b.page.title }));
  const outputOf = new Map<string, string>();
  for (const b of built) if (!outputOf.has(b.def.id)) outputOf.set(b.def.id, b.output);

  const themed = applyTheme(tpl.assets, tpl.manifest.theme, doc.theme);
  const files: FileMap = { ...themed.assets };

  for (const b of built) {
    let html = tpl.pages[b.def.file];
    const prefix = relPrefix(b.output);

    for (const region of tpl.manifest.nav) {
      const frag = tpl.fragments[region.fragment];
      const rendered = navItems
        .map((item) => frag.split(NAV_HREF).join(prefix + item.href).split(NAV_TITLE).join(escapeHtml(item.title)))
        .join("");
      html = html.split(navMarker(region.id)).join(rendered);
    }

    for (const r of b.def.repeats) {
      const frag = tpl.fragments[r.fragment];
      const rows = (b.page.repeats[r.id] ?? []).slice(0, r.max);
      const rendered = rows.map((row: Record<string, string>) => {
        let f = frag;
        for (const s of r.slots) f = f.split(`{{slot:${s.id}}}`).join(fillSlot(row[s.id], s.sample, s.html));
        return f;
      }).join("");
      html = html.split(repeatMarker(r.id)).join(rendered);
    }

    for (const s of b.def.slots) {
      const token = s.type === "image" ? `{{img:${s.id}}}` : `{{slot:${s.id}}}`;
      const value = s.type === "image" ? escapeHtml(b.page.slots[s.id]) : fillSlot(b.page.slots[s.id], s.sample, s.html);
      html = html.split(token).join(value);
    }

    html = html.split("{{title}}").join(escapeHtml(b.page.title));

    for (const t of findTokens(html)) {
      if (t.kind === "link") html = html.split(t.raw).join(prefix + (outputOf.get(t.key) ?? "index.html"));
      else if (t.kind === "id") html = html.split(t.raw).join(escapeHtml(doc.identity[t.key]));
    }

    if (themed.injectCssFile)
      html = html.replace("</head>", `<link rel="stylesheet" href="${prefix}${themed.injectCssFile}"></head>`);

    const leftovers = findTokens(html);
    if (leftovers.length > 0)
      return { ok: false, missing: leftovers.map((t) => ({ page_id: b.page.page_id, slot_id: `${t.kind}:${t.key}` })) };

    files[b.output] = new TextEncoder().encode(html);
  }

  return { ok: true, files };
}
