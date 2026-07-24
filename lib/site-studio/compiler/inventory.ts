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

/** Pass 1: classify files, parse pages (comments stripped), assign ids/kinds. */
export function inventory(files: FileMap): Inventory {
  const diagnostics: Diagnostic[] = [];
  const pages: PageSource[] = [];
  const assets: FileMap = {};
  let commentCount = 0;

  for (const [file, bytes] of Object.entries(files)) {
    if (!/\.html?$/i.test(file)) { assets[file] = bytes; continue; }
    const root = parse(new TextDecoder().decode(bytes), { comment: true });
    const comments = root.querySelectorAll("*")
      .flatMap((el) => el.childNodes).concat(root.childNodes)
      .filter((n): n is CommentNode => n instanceof CommentNode);
    for (const c of comments) c.remove();
    commentCount += comments.length;
    pages.push({ file, id: pageId(file), kind: pageKindFromFilename(file), root });
  }

  pages.sort((a, b) => (a.id === "index" ? -1 : b.id === "index" ? 1 : a.file.localeCompare(b.file)));

  if (commentCount > 0)
    diagnostics.push({ level: "info", code: "comments_stripped", message: `${commentCount} HTML comment(s) removed` });
  if (pages.length === 0)
    diagnostics.push({ level: "blocker", code: "no_pages", message: "Zip contains no HTML pages" });

  return { pages, assets, diagnostics };
}
