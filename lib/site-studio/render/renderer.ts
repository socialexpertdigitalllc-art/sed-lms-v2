import { CompiledTemplate, ContentDoc, ContentDocPage, FileMap, RenderResult } from "../schema";
import { escapeHtml, fillSlotValue, findTokens, navMarker, repeatMarker, NAV_HREF, NAV_TITLE } from "../tokens";
import { applyTheme } from "./theme";
import { annotatePageHtml, RenderOptions } from "./annotate";

const renderNavLi = (frag: string, href: string, label: string): string =>
  frag.split(NAV_HREF).join(href).split(NAV_TITLE).join(escapeHtml(label));

/** Depth-aware relative prefix: "services/sewer.html" links back up with "../". */
const relPrefix = (from: string) => "../".repeat(from.split("/").length - 1);

/** Apply the depth prefix to a nav href, unless it's absolute, scheme-qualified
 *  (http:, javascript:, …), protocol-relative (//host), or a bare anchor (#x) —
 *  those must render verbatim, never rewritten with "../". */
const prefixHref = (prefix: string, href: string): string =>
  /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href) ? href : prefix + href;

export function renderSite(tpl: CompiledTemplate, doc: ContentDoc, opts?: RenderOptions): RenderResult {
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

  // completeness: identity keys the skeletons actually reference (including
  // nav labels captured on region.items, which live in the manifest, not the
  // page/fragment skeletons)
  const navLabels = tpl.manifest.nav.flatMap((r) => (r.items ?? []).map((it) => it.label));
  const referenced = new Set(
    Object.values(tpl.pages).concat(Object.values(tpl.fragments)).concat(navLabels)
      .flatMap((html) => findTokens(html)).filter((t) => t.kind === "id").map((t) => t.key),
  );
  for (const key of referenced) if (!(key in doc.identity)) missing.push({ page_id: "(site)", slot_id: `id:${key}` });

  if (missing.length > 0) return { ok: false, missing };

  const builtByDefId = new Map(built.map((b) => [b.def.id, b]));
  const outputOf = new Map<string, string>();
  for (const b of built) if (!outputOf.has(b.def.id)) outputOf.set(b.def.id, b.output);

  const themed = applyTheme(tpl.assets, tpl.manifest.theme, doc.theme);
  const files: FileMap = { ...themed.assets };

  for (let docPageIndex = 0; docPageIndex < built.length; docPageIndex++) {
    const b = built[docPageIndex];
    let html = tpl.pages[b.def.file];
    const prefix = relPrefix(b.output);

    for (const region of tpl.manifest.nav) {
      const frag = tpl.fragments[region.fragment];
      const parts: string[] = [];
      if (region.items && region.items.length) {
        const seen = new Set<string>();
        for (const it of region.items) {
          if (it.page_id) {
            const nb = builtByDefId.get(it.page_id);
            // region.items records the ORIGINAL demo nav; stampable exists to
            // keep NEWLY stamped fan-out pages out of nav, not to evict a page
            // the demo site itself linked — so an explicit item renders even
            // when semantics later flips its page to a stampable kind.
            if (nb) {
              parts.push(renderNavLi(frag, prefix + nb.output, nb.page.nav_title ?? it.label));
              seen.add(it.page_id);
            }
            // page not built → skipped: nav-prune done right
          } else {
            parts.push(renderNavLi(frag, prefixHref(prefix, it.href), it.label)); // non-page nav link → verbatim
          }
        }
        // fan-out: built non-stampable pages that weren't in the original nav, appended in doc order
        for (const nb of built) {
          if (nb.def.stampable || seen.has(nb.def.id)) continue;
          parts.push(renderNavLi(frag, prefix + nb.output, nb.page.nav_title ?? nb.page.title));
        }
      } else {
        // fallback for manifests without items (e.g. hand-written test tpl): original behavior
        for (const nb of built) {
          if (nb.def.stampable) continue;
          parts.push(renderNavLi(frag, prefix + nb.output, nb.page.nav_title ?? nb.page.title));
        }
      }
      html = html.split(navMarker(region.id)).join(parts.join(""));
    }

    for (const r of b.def.repeats) {
      const frag = tpl.fragments[r.fragment];
      const rows = (b.page.repeats[r.id] ?? []).slice(0, r.max);
      const rendered = rows.map((row: Record<string, string>) => {
        let f = frag;
        for (const s of r.slots) f = f.split(`{{slot:${s.id}}}`).join(fillSlotValue(s, row[s.id]));
        return f;
      }).join("");
      html = html.split(repeatMarker(r.id)).join(rendered);
    }

    // Annotation (preview-only; see annotate.ts) takes over slot substitution
    // AND page marking here so it can locate each token's enclosing element
    // before it disappears. `opts?.annotate` defaults to falsy, so the
    // production path below is byte-for-byte what this function has always
    // produced — annotatePageHtml() is never even imported into that path.
    if (opts?.annotate) {
      html = annotatePageHtml(html, b.def, b.page, docPageIndex);
    } else {
      for (const s of b.def.slots) {
        const token = s.type === "image" ? `{{img:${s.id}}}` : `{{slot:${s.id}}}`;
        const value = s.type === "image" ? escapeHtml(b.page.slots[s.id]) : fillSlotValue(s, b.page.slots[s.id]);
        html = html.split(token).join(value);
      }
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
