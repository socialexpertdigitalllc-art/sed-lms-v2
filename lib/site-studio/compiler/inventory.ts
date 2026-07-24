import { parse, HTMLElement, CommentNode } from "node-html-parser";
import { Diagnostic, FileMap, PageKind, pageKindFromFilename } from "../schema";

export interface PageSource {
  file: string;
  id: string;
  kind: PageKind;
  root: HTMLElement;
}

export interface Inventory {
  pages: PageSource[];
  assets: FileMap;
  diagnostics: Diagnostic[];
}

const pageId = (file: string) =>
  file.replace(/\.html?$/i, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase();

/**
 * script/style bodies are raw text to the parser, so HTML comment markers
 * inside them are invisible to the CommentNode strip. If the whole body is
 * wrapped in the legacy `<!-- ... //-->` (or `-->`) idiom, unwrap it — that's
 * behavior-preserving since browsers ignore those markers there anyway.
 */
function stripLegacyScriptWrapper(text: string): { stripped: string; changed: boolean } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<!--")) return { stripped: text, changed: false };
  let body = trimmed.slice(4);
  if (body.endsWith("//-->")) body = body.slice(0, -5);
  else if (body.endsWith("-->")) body = body.slice(0, -3);
  return { stripped: body, changed: true };
}

/** Pass 1: classify files, parse pages (comments stripped), assign ids/kinds. */
export function inventory(files: FileMap): Inventory {
  const diagnostics: Diagnostic[] = [];
  const pages: PageSource[] = [];
  const assets: FileMap = {};
  const idOwners = new Map<string, string>();
  let commentCount = 0;

  for (const [file, bytes] of Object.entries(files)) {
    if (!/\.html?$/i.test(file)) { assets[file] = bytes; continue; }

    const id = pageId(file);
    const owner = idOwners.get(id);
    if (owner) {
      diagnostics.push({
        level: "blocker",
        code: "page_id_collision",
        message: `"${owner}" and "${file}" both resolve to page id "${id}"`,
      });
      continue;
    }
    idOwners.set(id, file);

    const decoded = new TextDecoder().decode(bytes);
    if (decoded.includes("�")) {
      diagnostics.push({
        level: "warn",
        code: "encoding_suspect",
        page: file,
        message: `${file} decoded with replacement characters — likely not UTF-8`,
      });
    }

    const root = parse(decoded, { comment: true });
    const comments = root.querySelectorAll("*")
      .flatMap((el) => el.childNodes).concat(root.childNodes)
      .filter((n): n is CommentNode => n instanceof CommentNode);
    for (const c of comments) c.remove();
    commentCount += comments.length;

    for (const el of root.querySelectorAll("script, style")) {
      const textNode = el.childNodes[0];
      if (!textNode || typeof (textNode as { rawText?: unknown }).rawText !== "string") continue;
      const node = textNode as unknown as { rawText: string };
      let body = node.rawText;
      const { stripped, changed } = stripLegacyScriptWrapper(body);
      if (changed) {
        node.rawText = stripped;
        commentCount += 1;
        body = stripped;
      }
      if (body.includes("<!--")) {
        diagnostics.push({
          level: "warn",
          code: "script_comment_content",
          page: file,
          message: `${file}: HTML-comment content embedded in <${el.rawTagName}> needs manual review`,
        });
      }
    }

    pages.push({ file, id, kind: pageKindFromFilename(file), root });
  }

  pages.sort((a, b) =>
    a.id === "index" ? -1 : b.id === "index" ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0
  );

  if (commentCount > 0)
    diagnostics.push({ level: "info", code: "comments_stripped", message: `${commentCount} HTML comment(s) removed` });
  if (pages.length === 0)
    diagnostics.push({ level: "blocker", code: "no_pages", message: "Zip contains no HTML pages" });

  return { pages, assets, diagnostics };
}
