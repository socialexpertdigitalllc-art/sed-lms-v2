import type { SuppliedImage } from "./prompt";

/**
 * Picked images become FILES INSIDE THE SITE, not links out of it.
 *
 * WHY THIS EXISTS. A pick is stored as a long-lived *signed* Supabase URL
 * (`…/object/sign/studio-assets/<uuid>.jpg?token=<JWT>`) — a ~300-character
 * string whose query token is mandatory: without it the object returns
 * `{"error":"querystring must have required property 'token'"}`. Handing that
 * to a model and asking it to reproduce it verbatim inside an `<img src>` is a
 * losing bet, and it lost in production: of one run's three pages carrying a
 * signed URL, only two still had the token — the model silently truncated the
 * third, so that page's images 400'd on the live site.
 *
 * Even reproduced perfectly it would be the wrong thing to ship: it pins a
 * client's site to our private bucket and its signing key, leaks internal
 * infrastructure into their HTML, and makes a downloaded zip useless offline.
 *
 * So the bytes are pulled ONCE at generation time, written into the site as
 * `images/<purpose>-<n>.<ext>`, and the model is given only that short
 * relative path. It cannot mangle a token that isn't there, the deployed site
 * has no external dependency, and the zip an operator downloads is complete.
 */

/** Where bundled images live inside the generated site. */
export const SITE_IMAGE_DIR = "images";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const ALLOWED_EXT = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif", "svg"]);

/** lowercase, non-alphanumeric runs -> '-', trimmed, capped — the same shape
 *  `run.ts` uses for page filenames, kept short so a path stays unmanglable. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** The file extension to save a pick under: the URL's own extension when it
 *  is a real image one, else whatever the response's content-type says, else
 *  jpg (the overwhelmingly common case and a safe default for a browser). */
export function extensionFor(url: string, contentType?: string | null): string {
  const fromType = EXT_BY_CONTENT_TYPE[(contentType ?? "").split(";")[0].trim().toLowerCase()];
  if (fromType) return fromType;
  try {
    const path = new URL(url).pathname;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (ALLOWED_EXT.has(ext)) return ext === "jpeg" ? "jpg" : ext;
  } catch {
    // not a parseable URL — fall through
  }
  return "jpg";
}

/**
 * Deterministic in-site path for one pick. Deterministic MATTERS: a
 * regeneration re-derives the same names from the same run, so a page written
 * in one pass and a page rewritten later agree on where an image lives
 * without any extra bookkeeping.
 *
 * `index` disambiguates same-purpose picks (three Hero images, a Gallery of
 * ten), and is what makes the name collision-free without hashing.
 */
export function siteImagePath(purpose: string, index: number, ext: string): string {
  const base = slugify(purpose) || "image";
  return `${SITE_IMAGE_DIR}/${base}-${index + 1}.${ext}`;
}

/** True for a path this module owns — i.e. a bundled site image, as opposed
 *  to a template asset or a generated page. */
export function isSiteImagePath(path: string): boolean {
  return path.startsWith(`${SITE_IMAGE_DIR}/`);
}

/**
 * The bundled images out of an already-assembled site zip.
 *
 * Once a run has produced its zip, THAT is where the site's images live —
 * there is no second copy and no URL to re-fetch. A regeneration rebuilding
 * the zip, and the preview serving a page, both read them back from here so
 * neither needs the original storage URL (which is deliberately not kept: it
 * is precisely the thing that must never reach a page again).
 */
export function siteImagesFromZip(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) {
    if (isSiteImagePath(path)) out[path] = bytes;
  }
  return out;
}

export interface LocalizedImages {
  /** What the PROMPT sees: the same picks, each `url` replaced by its
   *  in-site relative path. Only successfully-downloaded picks appear — the
   *  model is never told about an image the site does not actually have. */
  images: SuppliedImage[];
  /** Bytes to write into the site, keyed by that same relative path. */
  files: Record<string, Uint8Array>;
  /** One line per pick that could not be fetched. Never thrown — a missing
   *  image must not fail a whole site — but surfaced so the run can say so. */
  failures: string[];
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Download every pick and lay it out inside the site. Never throws: a pick
 * that 404s, times out, or comes back as something that isn't an image is
 * dropped from BOTH the file map and the prompt's image list, so the model
 * simply never learns about it — far better than a page referencing a file
 * that was never written.
 *
 * `fetchImpl` is the seam: production passes the global `fetch`, tests pass a
 * stub, so nothing here ever touches the network under test.
 */
export async function localizeImages(
  picks: SuppliedImage[],
  fetchImpl: typeof fetch = fetch,
): Promise<LocalizedImages> {
  const images: SuppliedImage[] = [];
  const files: Record<string, Uint8Array> = {};
  const failures: string[] = [];

  // Per-purpose counter, so "Hero" picks become hero-1/hero-2/hero-3 and a
  // "Service: Drains" pick becomes service-drains-1 — readable in the HTML
  // and stable across regenerations.
  const seen = new Map<string, number>();

  const results = await Promise.all(
    picks.map(async (pick) => {
      try {
        const res = await fetchImpl(pick.url);
        if (!res.ok) return { pick, error: `HTTP ${res.status}` } as const;
        const contentType = res.headers.get("content-type");
        if (contentType && !contentType.toLowerCase().startsWith("image/")) {
          return { pick, error: `not an image (${contentType.split(";")[0].trim()})` } as const;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength === 0) return { pick, error: "empty response" } as const;
        if (buf.byteLength > MAX_IMAGE_BYTES) {
          return { pick, error: `too large (${buf.byteLength} bytes)` } as const;
        }
        return { pick, bytes: buf, ext: extensionFor(pick.url, contentType) } as const;
      } catch (e) {
        return { pick, error: e instanceof Error ? e.message : String(e) } as const;
      }
    }),
  );

  for (const result of results) {
    if ("error" in result) {
      failures.push(`${result.pick.purpose}: ${result.error}`);
      continue;
    }
    const index = seen.get(result.pick.purpose) ?? 0;
    seen.set(result.pick.purpose, index + 1);
    const path = siteImagePath(result.pick.purpose, index, result.ext);
    files[path] = result.bytes;
    images.push({ url: path, purpose: result.pick.purpose, file: path });
  }

  return { images, files, failures };
}
