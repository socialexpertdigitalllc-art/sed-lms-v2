import { CompiledTemplate, Diagnostic, PageDef, TemplateManifest } from "../schema";
import { unzipToMap } from "../zip";
import { inventory } from "./inventory";
import { extractIdentity } from "./identity";
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

  const { identity, diagnostics: idDiags } = extractIdentity(inv);
  diagnostics.push(...idDiags);

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

  const theme = extractTheme(inv.assets);
  diagnostics.push(...theme.diagnostics);
  diagnostics.push(...flagJs(inv, identity));

  const manifest: TemplateManifest = {
    engine: 3, name, version: 1, identity,
    theme: theme.theme, nav: nav.regions, pages: pageDefs,
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
