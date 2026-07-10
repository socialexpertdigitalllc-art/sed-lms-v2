import type { ManifestPage, PageKind, TemplateManifest } from "./types";

export const MAX_EXTRACTED_BYTES = 60 * 1024 * 1024;

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif)$/;
const PAGE_EXT_RE = /\.html?$/;

/** Infer a page kind from its filename (case-insensitive on the basename). */
export function classifyPage(filename: string): PageKind {
  const base = filename.toLowerCase().replace(/\\/g, "/").split("/").pop() ?? "";
  const stem = base.replace(/\.[^.]+$/, "");

  if (/^(index|home|homepage)$/.test(stem)) return "home";
  if (stem.includes("about")) return "about";
  if (stem.includes("gallery") || stem.includes("portfolio")) return "gallery";
  if (stem.includes("contact")) return "contact";
  // plural "areas" (service-areas, service_areas, areas) before any singular checks
  if (stem.includes("areas")) return "areas_hub";
  // plural "services" wins over singular "service" unless it's a detail pattern
  if (stem.includes("services")) {
    if (stem.includes("detail") || stem.includes("individual")) return "service_detail";
    return "services_hub";
  }
  if (stem.includes("service")) return "service_detail"; // service, service-detail, individual-service, service-page
  if (stem.includes("area")) return "area_detail"; // area, area-detail, individual-area
  return "other";
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function baseNameNoExt(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

/** Build the stored manifest from an extracted template file map. */
export function buildManifest(files: Record<string, Uint8Array>): TemplateManifest {
  const decoder = new TextDecoder();
  const pages: ManifestPage[] = [];
  const css: string[] = [];
  const js: string[] = [];
  let components: string | null = null;
  const assets: string[] = [];
  const imageFiles: string[] = [];
  let totalBytes = 0;

  for (const name of Object.keys(files).sort()) {
    totalBytes += files[name].byteLength;
    const lower = name.toLowerCase();
    const base = lower.split("/").pop() ?? lower;

    if (PAGE_EXT_RE.test(lower)) {
      const title = extractTitle(decoder.decode(files[name]));
      pages.push({ file: name, title: title || baseNameNoExt(name), kind: classifyPage(name) });
    } else if (lower.endsWith(".css")) {
      css.push(name);
    } else if (lower.endsWith(".js")) {
      if (base === "components.js" && components === null) components = name;
      else js.push(name);
    } else if (IMAGE_EXT_RE.test(lower)) {
      imageFiles.push(name);
    } else {
      assets.push(name);
    }
  }

  return { pages, css, js, components, assets, imageFiles, totalBytes };
}

/** null when the manifest is acceptable, otherwise a human-readable error. */
export function validateTemplate(m: TemplateManifest): string | null {
  if (m.pages.length === 0) return "Template has no HTML pages";
  if (m.totalBytes > MAX_EXTRACTED_BYTES) {
    return `Template is too large (${(m.totalBytes / (1024 * 1024)).toFixed(1)}MB extracted; max 60MB)`;
  }
  return null;
}
