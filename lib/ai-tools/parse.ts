// Parse the model's multi-file response into individual files.
// Format (from the prompt): [FILE: name.html] ... [END_FILE]

export interface GeneratedFile {
  name: string;
  code: string;
}

const FILE_RE = /\[FILE:\s*([\w\-.]+)\]([\s\S]*?)\[END_FILE\]/gi;

export function parseFiles(raw: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  let m: RegExpExecArray | null;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(raw)) !== null) {
    files.push({ name: m[1].trim(), code: stripFences(m[2].trim()) });
  }
  if (files.length) return files;

  // Fallback: the model ignored the delimiters — pull out raw HTML.
  const html = extractHTML(raw);
  return html ? [{ name: "index.html", code: html }] : [];
}

// Strip a leading/trailing markdown code fence if the model wrapped a file.
function stripFences(code: string): string {
  return code
    .replace(/^```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

export function extractHTML(raw: string): string {
  // Prefer a fenced ```html block.
  const fence = raw.match(/```html\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  if (fence && /<!DOCTYPE|<html/i.test(fence[1])) return fence[1].trim();

  const start = raw.search(/<!DOCTYPE html>|<html/i);
  if (start !== -1) {
    const endIdx = raw.lastIndexOf("</html>");
    return endIdx !== -1 ? raw.slice(start, endIdx + 7).trim() : raw.slice(start).trim();
  }
  return "";
}

export function countWords(files: GeneratedFile[]): number {
  return files.reduce((acc, f) => {
    const text = f.code.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return acc + (text ? text.split(" ").length : 0);
  }, 0);
}

export function countImages(files: GeneratedFile[]): number {
  return files.reduce((acc, f) => acc + (f.code.match(/<img\b/gi)?.length ?? 0), 0);
}
