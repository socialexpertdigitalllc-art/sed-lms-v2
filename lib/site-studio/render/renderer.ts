import { CompiledTemplate, ContentDoc, ContentDocPage, FileMap, RenderResult } from "../schema";
import {
  BRAND_TOKEN, escapeCssString, escapeHtml, escapeJsString, fillSlotValue, findTokens,
  navMarker, repeatMarker, NAV_HREF, NAV_TITLE,
} from "../tokens";
import { applyTheme, applyThemeToHtml } from "./theme";
import { annotatePageHtml, annotateRepeatRow, RenderOptions } from "./annotate";

// Context-aware escape for an identity value substituted into a tokenized
// text asset, keyed by file extension — mirrors compiler/assetIdentity.ts's
// TEXT_ASSET_RE scope (.js/.css only; see that file for why other text
// types are deliberately out of scope). A value dropped in unescaped can
// break the asset's syntax outright (a business name with an apostrophe
// closing a JS string early) rather than just misrender — see
// escapeJsString/escapeCssString in ../tokens.ts for the exact rules.
function assetEscapeFor(path: string): (s: string) => string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "js" || ext === "mjs" || ext === "cjs") return escapeJsString;
  if (ext === "css") return escapeCssString;
  return (s) => s;
}

/** Substitute {{id:*}} tokens in every manifest-recorded tokenized asset,
 *  context-escaping each value for the asset's file type. Assets not listed
 *  are copied through untouched (unchanged behavior). */
function substituteAssetIdentity(
  assets: FileMap, tokenizedAssets: string[], identity: Record<string, string>,
): { files: FileMap; leftover: { path: string; key: string }[] } {
  const files: FileMap = { ...assets };
  const leftover: { path: string; key: string }[] = [];

  for (const path of tokenizedAssets) {
    const bytes = files[path];
    if (!bytes) continue;
    const escape = assetEscapeFor(path);
    let text = new TextDecoder().decode(bytes);
    for (const t of findTokens(text)) {
      if (t.kind !== "id") continue;
      const value = identity[t.key];
      if (value === undefined) continue; // caught by the referenced-key completeness check below
      text = text.split(t.raw).join(escape(value));
    }
    for (const t of findTokens(text)) if (t.kind === "id") leftover.push({ path, key: t.key });
    files[path] = new TextEncoder().encode(text);
  }

  return { files, leftover };
}

const renderNavLi = (frag: string, href: string, label: string): string =>
  frag.split(NAV_HREF).join(href).split(NAV_TITLE).join(escapeHtml(label));

/**
 * {{brand}} (Phase 4c, Task 5) — the site's brand element, marked by the
 * compiler's identity pass (compiler/identity.ts's extractBrand) on a
 * header/footer wordmark. Unlike an {{id:*}} token this isn't unconditional
 * value substitution: it renders an <img> when the doc's identity carries a
 * non-empty `logo`, or text otherwise — see tokens.ts's BRAND_TOKEN doc
 * comment.
 *
 * The no-logo TEXT branch has two cases, both driven by comparing the doc's
 * `business_name` against `tpl.manifest.identity.business_name` (the value
 * the compiler captured from the DEMO template, always what
 * `sampleContentDoc` copies verbatim):
 *   - they match (rendering the demo/sample identity — this is exactly what
 *     the verification round-trip and golden-hash tests do): reproduce
 *     `tpl.manifest.brand.sample`, the LITERAL original text captured at the
 *     brand element, verbatim. That text (e.g. "NORTHPOINT") may be a
 *     stylized short form that differs from the full business name (e.g.
 *     "Northpoint Remodeling") — using the sample instead of re-deriving
 *     from business_name is the only way to reproduce the original bytes.
 *   - they differ (a real, distinct client): show the client's own escaped
 *     business name — the actual product requirement ("if it's empty just
 *     add the business name there").
 *
 * Both branches route through escapeHtml, matching every other identity
 * substitution in this file (see the `id` branch below) — never dropped in
 * raw, for the same reason `fillSlotValue` exists: an unescaped value can
 * inject a live attribute or break the surrounding markup.
 */
function renderBrand(tpl: CompiledTemplate, doc: ContentDoc): string {
  const logo = doc.identity.logo;
  const businessName = doc.identity.business_name ?? "";
  if (logo) return `<img src="${escapeHtml(logo)}" alt="${escapeHtml(businessName)}">`;

  const sample = tpl.manifest.brand?.sample;
  const isDemoIdentity = sample !== undefined && businessName === (tpl.manifest.identity.business_name ?? "");
  return escapeHtml(isDemoIdentity ? sample! : businessName);
}

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
  // page/fragment skeletons; and identity tokens inside tokenized text
  // assets, which live in tpl.assets' bytes, not tpl.pages/tpl.fragments)
  const navLabels = tpl.manifest.nav.flatMap((r) => (r.items ?? []).map((it) => it.label));
  const tokenizedAssetPaths = tpl.manifest.tokenizedAssets ?? [];
  const assetTexts = tokenizedAssetPaths.map((p) => new TextDecoder().decode(tpl.assets[p] ?? new Uint8Array()));
  const allSkeletonText = Object.values(tpl.pages).concat(Object.values(tpl.fragments)).concat(navLabels).concat(assetTexts);
  const referenced = new Set(
    allSkeletonText.flatMap((html) => findTokens(html)).filter((t) => t.kind === "id").map((t) => t.key),
  );
  // {{brand}} isn't an {{id:*}} token (see tokens.ts), so it's invisible to
  // the scan above — but its no-logo fallback still needs business_name, so
  // a template using it must be treated as if it referenced that key too.
  if (allSkeletonText.some((html) => html.includes(BRAND_TOKEN))) referenced.add("business_name");
  for (const key of referenced) if (!(key in doc.identity)) missing.push({ page_id: "(site)", slot_id: `id:${key}` });

  if (missing.length > 0) return { ok: false, missing };

  const builtByDefId = new Map(built.map((b) => [b.def.id, b]));
  const outputOf = new Map<string, string>();
  for (const b of built) if (!outputOf.has(b.def.id)) outputOf.set(b.def.id, b.output);

  const themed = applyTheme(tpl.assets, tpl.manifest.theme, doc.theme);
  const assetSub = substituteAssetIdentity(themed.assets, tokenizedAssetPaths, doc.identity);
  if (assetSub.leftover.length > 0) {
    return {
      ok: false,
      missing: assetSub.leftover.map((l) => ({ page_id: "(site)", slot_id: `asset:${l.path}:id:${l.key}` })),
    };
  }
  const files: FileMap = { ...assetSub.files };

  // Computed once — {{brand}}'s resolved shape depends only on the doc's
  // identity/manifest, never on which page it's rendered into.
  const brandHtml = renderBrand(tpl, doc);

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

    // Annotation (preview-only; see annotate.ts) takes over BOTH repeat-row
    // and page-level slot substitution here so it can locate each token's
    // enclosing element before it disappears — repeat rows are resolved to
    // plain values first (this is whole-site, string-based rendering, and a
    // row's tokens are gone the moment the fragment is substituted), so if
    // that resolution didn't ALSO annotate, repeat content (services lists,
    // testimonials, team grids — anything the compiler auto-detects as ≥3
    // congruent siblings) would be entirely unreachable from Gate 2's
    // preview. `opts?.annotate` defaults to falsy, so the production path in
    // both branches below is byte-for-byte what this function has always
    // produced — annotatePageHtml()/annotateRepeatRow() are never even
    // imported into that path.
    for (const r of b.def.repeats) {
      const frag = tpl.fragments[r.fragment];
      const rows = (b.page.repeats[r.id] ?? []).slice(0, r.max);
      const rendered = rows.map((row: Record<string, string>, rowIndex: number) => {
        if (opts?.annotate) return annotateRepeatRow(frag, r.slots, row, docPageIndex, r.id, rowIndex);
        let f = frag;
        for (const s of r.slots) f = f.split(`{{slot:${s.id}}}`).join(fillSlotValue(s, row[s.id]));
        return f;
      }).join("");
      html = html.split(repeatMarker(r.id)).join(rendered);
    }

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
    if (html.includes(BRAND_TOKEN)) html = html.split(BRAND_TOKEN).join(brandHtml);

    for (const t of findTokens(html)) {
      if (t.kind === "link") html = html.split(t.raw).join(prefix + (outputOf.get(t.key) ?? "index.html"));
      else if (t.kind === "id") html = html.split(t.raw).join(escapeHtml(doc.identity[t.key]));
    }

    // Literal brand-color retint (Phase 4c) — a rendered page's HTML is not
    // one of `tpl.assets`' entries (it's assembled fresh right here), so
    // `applyTheme` above never sees it; this is the sibling pass that covers
    // inline `style="color:#0C5AA0"` attributes and any other literal
    // occurrence of a mapped role's own demo hex baked into the skeleton
    // markup. See theme.ts's `applyThemeToHtml` doc comment for scope
    // (css_vars mode only) and why it can't be folded into `applyTheme`.
    html = applyThemeToHtml(html, tpl.manifest.theme, doc.theme);

    if (themed.injectCssFile)
      html = html.replace("</head>", `<link rel="stylesheet" href="${prefix}${themed.injectCssFile}"></head>`);

    const leftovers = findTokens(html);
    if (leftovers.length > 0)
      return { ok: false, missing: leftovers.map((t) => ({ page_id: b.page.page_id, slot_id: `${t.kind}:${t.key}` })) };

    files[b.output] = new TextEncoder().encode(html);
  }

  return { ok: true, files };
}
