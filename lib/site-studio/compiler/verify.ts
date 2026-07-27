import { parse, HTMLElement, NodeType } from "node-html-parser";
import { CompiledTemplate, Diagnostic, FileMap } from "../schema";
import { sampleContentDoc } from "../sample";
import { renderSite } from "../render/renderer";

const decode = (s: string) => parse(`<x>${s}</x>`).firstChild?.text ?? s;

/** Canonical serialization: tags + attributes as-is, text collapsed and entity-decoded. */
export function normalizeHtml(html: string): string {
  const walk = (node: any): string => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      const t = decode(node.rawText).replace(/\s+/g, " ").trim();
      return t.length ? t : "";
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.rawTagName?.toLowerCase() ?? "";
    const attrs = Object.entries(el.attributes)
      // escape " in the value so an embedded quote can't forge a fake `key="value`
      // boundary and let two structurally-different tags normalize identically
      .map(([k, v]) => `${k}="${decode(v).replace(/\s+/g, " ").trim().replace(/"/g, "&quot;")}"`)
      .join(" ");
    const inner = el.childNodes.map(walk).filter(Boolean).join("|");
    return `<${tag}${attrs ? " " + attrs : ""}>${inner}</${tag}>`;
  };
  return parse(html).childNodes.map(walk).filter(Boolean).join("|");
}

/** Pass 7: the package must reproduce the original demo site from its own samples. */
export function verifyTemplate(template: CompiledTemplate, original: FileMap): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const rendered = renderSite(template, sampleContentDoc(template.manifest));
  if (!rendered.ok) {
    for (const m of rendered.missing)
      diagnostics.push({ level: "blocker", code: "roundtrip_render_refused", page: m.page_id, message: `Verification render refused: missing ${m.slot_id}` });
    return diagnostics;
  }
  for (const page of template.manifest.pages) {
    const orig = original[page.file];
    const out = rendered.files[page.file];
    if (!orig || !out) {
      diagnostics.push({ level: "blocker", code: "roundtrip_mismatch", page: page.file, message: `${page.file} missing from ${orig ? "render output" : "original"}` });
      continue;
    }
    const a = normalizeHtml(new TextDecoder().decode(orig));
    const b = normalizeHtml(new TextDecoder().decode(out));
    if (a !== b) {
      const at = [...a].findIndex((ch, i) => b[i] !== ch);
      diagnostics.push({
        level: "blocker", code: "roundtrip_mismatch", page: page.file,
        message: `${page.file} does not reproduce the original (first divergence near char ${at}: "${a.slice(Math.max(0, at - 40), at + 40)}" vs "${b.slice(Math.max(0, at - 40), at + 40)}")`,
      });
    }
  }

  // A tokenized text asset (.js/.css whose bytes the compiler replaced a
  // demo identity value with a {{id:*}} token in) must reproduce the
  // ORIGINAL asset bytes exactly when rendered from the sample content doc
  // (sample identity values ARE the original demo values — see
  // sample.ts). Without this check, a bug in the asset-identity pass or its
  // render-time substitution/escaping would be invisible: manifest.pages
  // alone never looks at assets at all.
  for (const path of template.manifest.tokenizedAssets ?? []) {
    const orig = original[path];
    const out = rendered.files[path];
    if (!orig || !out) {
      diagnostics.push({ level: "blocker", code: "roundtrip_mismatch", page: path, message: `${path} (tokenized asset) missing from ${orig ? "render output" : "original"}` });
      continue;
    }
    const a = new TextDecoder().decode(orig);
    const b = new TextDecoder().decode(out);
    if (a !== b) {
      const at = [...a].findIndex((ch, i) => b[i] !== ch);
      diagnostics.push({
        level: "blocker", code: "roundtrip_mismatch", page: path,
        message: `${path} (tokenized asset) does not reproduce the original (first divergence near char ${at}: "${a.slice(Math.max(0, at - 40), at + 40)}" vs "${b.slice(Math.max(0, at - 40), at + 40)}")`,
      });
    }
  }

  return diagnostics;
}
