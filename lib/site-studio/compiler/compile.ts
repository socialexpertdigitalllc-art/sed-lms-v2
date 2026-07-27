import { CompiledTemplate, Diagnostic, PageDef, TemplateManifest } from "../schema";
import { unzipToMap } from "../zip";
import { inventory } from "./inventory";
import { extractIdentity } from "./identity";
import { tokenizeAssetIdentity } from "./assetIdentity";
import { extractNav } from "./nav";
import { tokenizeInternalLinks } from "./links";
import { extractRepeats } from "./repeats";
import { extractSlots } from "./slots";
import { extractTheme } from "./theme";
import { flagJs } from "./jsflags";
import { verifyTemplate } from "./verify";

export interface CompileResult {
  ok: boolean;
  template: CompiledTemplate;
  diagnostics: Diagnostic[];
}

/**
 * The deterministic compile pipeline. Order matters:
 * identity first (tokens flow into fragments/samples), nav before repeats
 * (nav lists must not become repeats), repeats before slots (card text
 * belongs to fragments, not page slots).
 *
 * @throws synchronously if `unzipToMap` rejects a malformed or unsafe zip
 * (bad archive, path traversal, duplicate paths). Phase 1 has no upload
 * route calling this directly; the Phase 2 upload route must catch this
 * and convert it into a blocker diagnostic rather than letting it bubble up.
 */
export function compileTemplate(zipBytes: Uint8Array, name: string): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const files = unzipToMap(zipBytes);
  const inv = inventory(files);
  diagnostics.push(...inv.diagnostics);

  const { identity, diagnostics: idDiags, brand } = extractIdentity(inv);
  diagnostics.push(...idDiags);

  // Pass 2b: tokenize the SAME identity values inside text assets (.js/.css)
  // so a client's deployed site never renders the template author's own
  // business name/phone/etc. from a runtime-built header/nav script.
  // inv.assets is replaced with the tokenized bytes here so everything
  // downstream (theme extraction, flagJs, the final CompiledTemplate) sees
  // the tokenized version, not the raw demo bytes.
  const assetTok = tokenizeAssetIdentity(inv, identity);
  inv.assets = assetTok.assets;

  const nav = extractNav(inv);
  diagnostics.push(...nav.diagnostics);
  diagnostics.push(...tokenizeInternalLinks(inv));

  const fragments: Record<string, string> = { ...nav.fragments };
  const pageDefs: PageDef[] = [];
  const pages: Record<string, string> = {};

  for (const page of inv.pages) {
    const rep = extractRepeats(page);
    diagnostics.push(...rep.diagnostics);
    Object.assign(fragments, rep.fragments);

    const slot = extractSlots(page);
    diagnostics.push(...slot.diagnostics);

    pageDefs.push({
      id: page.id, file: page.file, kind: page.kind,
      // page.kind only ever comes from pageKindFromFilename (see ../schema),
      // which emits "services_hub"/"areas_hub" — never the singular
      // "service"/"area". So this stays false until Phase 2's AI semantic-label
      // pass can assign singular kinds; the branch is intentionally inert in Phase 1.
      stampable: page.kind === "service" || page.kind === "area",
      title_sample: slot.titleSample,
      slots: slot.slots,
      repeats: rep.repeats,
    });
    pages[page.file] = page.root.toString();
  }

  // `pages` (built by the loop above) is passed so theme_literal_colors can
  // count a mapped role's literal hex in page HTML too, not just CSS assets
  // — see theme.ts's own doc comment on the diagnostic.
  const theme = extractTheme(inv.assets, pages);
  diagnostics.push(...theme.diagnostics);
  // flagJs runs AFTER asset tokenization: any demo identity value it still
  // finds in inv.assets survived the tokenization pass above (a form the
  // pass's literal-substring match couldn't safely rewrite — inside a regex
  // literal, split across concatenation, minified beyond recognition). That
  // is a genuine residual leak, not merely something to review — see
  // flagJs's asset_identity_echo, promoted to a blocker.
  diagnostics.push(...flagJs(inv, identity));

  const manifest: TemplateManifest = {
    engine: 3, name, version: 1, identity,
    theme: theme.theme, nav: nav.regions, pages: pageDefs,
    tokenizedAssets: assetTok.tokenizedAssets,
    ...(brand ? { brand } : {}),
  };

  const template: CompiledTemplate = { manifest, pages, fragments, assets: inv.assets };
  if (!diagnostics.some((d) => d.level === "blocker") && inv.pages.length > 0)
    diagnostics.push(...verifyTemplate(template, files));

  return {
    ok: !diagnostics.some((d) => d.level === "blocker"),
    template,
    diagnostics,
  };
}
