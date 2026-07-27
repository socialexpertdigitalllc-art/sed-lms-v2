import type { ContentDoc, ContentDocPage, FileMap, TemplateManifest } from "../schema";

/** What a picked asset needs to become a real file in the zip — enough to
 *  choose an extension and write the bytes, nothing storage-specific (the
 *  caller owns however it actually reads from the `studio-assets` bucket). */
export interface LoadedAsset {
  bytes: Uint8Array;
  contentType: string;
  storagePath: string;
}

export interface ResolveAssetsDeps {
  /** Returns null (never throws) when the asset can't be loaded — a missing
   *  row, a bucket download failure, anything. `resolveAssets` treats null
   *  exactly like "this asset failed to resolve": the id lands in `missing`
   *  and the slot's `asset:` value is left exactly as it was. */
  loadAssetBytes(assetId: string): Promise<LoadedAsset | null>;
}

export interface ResolveAssetsResult {
  doc: ContentDoc;
  files: FileMap;
  /** Asset ids that failed to load — a picked image the run can't actually
   *  ship. The caller decides what to do (finalize.ts fails the run naming
   *  these; nothing here does that on its own, since this function is pure
   *  apart from the injected loader). */
  missing: string[];
}

const ASSET_REF = /^asset:(.+)$/;

/** Every content type `rehostFromUrl` (assets/rehost.ts) will actually store
 *  — a loaded asset's bytes were already restricted to this set at rehost
 *  time, so anything else here would indicate a bug upstream, not a normal
 *  runtime condition. Falls back to `bin` defensively rather than throwing:
 *  a wrong-but-present extension is still a shippable file, and resolving
 *  assets must never be the thing that fails a run outright. */
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** Depth-aware relative prefix, identical in spirit to the renderer's own
 *  `relPrefix` (render/renderer.ts) — repeated here rather than imported
 *  because the renderer's is a private, file-local helper and the two
 *  belong to genuinely different responsibilities (nav/CSS-link rewriting
 *  vs. image-slot rewriting) that happen to share one formula. A page with
 *  no `output` is a non-stamped page, which is always a root-level file by
 *  this template convention (every fixture and manifest in this repo names
 *  non-stamped pages "index.html", "about.html", etc. — never nested), so
 *  depth 0 is the correct default without needing the manifest here. */
function depthOf(page: ContentDocPage): number {
  return page.output ? page.output.split("/").length - 1 : 0;
}
function relPrefix(depth: number): string {
  return "../".repeat(depth);
}

/**
 * True for a value that must NOT be given a relative-depth prefix: empty,
 * scheme-qualified (`https:…`, and `asset:` itself, though that's always
 * handled separately before this check runs), site-absolute (`/…`), or a
 * bare anchor (`#…`). Everything else reaching this check is already known
 * — by the manifest's own declared slot type, checked by the caller, NEVER
 * by guessing from the value's shape — to be an image slot's bare
 * template-relative path, and gets the prefix.
 *
 * A prior version of this function tried to infer "is this an image value"
 * from the STRING alone (ends in a known image extension, no scheme/anchor).
 * That heuristic was falsified by review: an ordinary hyphenated TEXT value
 * like "5-star-rated.svg" or "Contact-us-today.jpg" matches it just as
 * well as a real image path, and would have been silently rewritten to
 * "../5-star-rated.svg" in the client's visible copy on any stamped page —
 * neither the Writer's DISALLOWED regex nor the operator-edit validator
 * blocks a plain word ending that way. The manifest's `slot.type` is
 * authoritative and this function is now only ever called on slots the
 * caller has already confirmed are declared `type: "image"`.
 */
function needsNoPrefix(value: string): boolean {
  if (!value) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
  if (value.startsWith("/") || value.startsWith("#")) return true;
  return false;
}

/**
 * Resolves every `asset:{uuid}` slot value into a REAL file the deployed
 * zip carries — never a bucket URL, never a Pexels URL (spec §8's "rehost,
 * never hot-link", carried all the way to the final artifact). Each distinct
 * asset id is fetched exactly ONCE regardless of how many slots (across any
 * number of pages) picked it, and lands in `files` at
 * `img/studio/{assetId}.{ext}`. Every resolved (or already-bare-relative)
 * image value is rewritten to a DEPTH-CORRECT relative path for the page
 * that holds it — `img/studio/x.jpg` on a root page, `../img/studio/x.jpg`
 * on a page whose `output` is `services/drain-cleaning.html`.
 *
 * This second part — depth-adjusting bare template-relative image paths,
 * not just resolved `asset:` ones — exists because the renderer
 * (render/renderer.ts) does NOT depth-adjust `{{img:*}}` substitutions the
 * way it does nav hrefs and the injected CSS link: an image slot's value is
 * dropped into the page verbatim. Probed directly against the fixture used
 * in `tests/siteStudioResolveAssets.test.ts`: a stamped page (`output:
 * "services/x.html"`) whose image slot still held the template's own sample
 * (`img/hero.jpg`, never touched by a pick) rendered `src="img/hero.jpg"` —
 * which resolves relative to `services/x.html` as `services/img/hero.jpg`,
 * a 404 on a real deploy. So this function is the one place in the pipeline
 * that makes EVERY image slot value depth-correct before it ever reaches the
 * renderer, not just the ones an operator picked.
 *
 * SLOT TYPING: both the `asset:` resolution and the bare-path depth
 * adjustment touch ONLY slots the MANIFEST declares `type: "image"` for a
 * given page — never inferred from a value's shape. A text slot can
 * legitimately hold a value that looks like a file path (e.g. an operator
 * or the Writer producing "5-star-rated.svg" or "Contact-us-today.jpg" as
 * plain copy); nothing about `contentDocSchema` or the Writer's own
 * `DISALLOWED` check would catch that, so this function must not either.
 * `manifest` is what makes that distinction authoritative.
 *
 * Pure apart from the injected loader (`deps.loadAssetBytes`); does not
 * mutate its input doc.
 */
export async function resolveAssets(
  deps: ResolveAssetsDeps,
  manifest: TemplateManifest,
  doc: ContentDoc,
): Promise<ResolveAssetsResult> {
  const pageDefs = new Map(manifest.pages.map((p) => [p.id, p]));
  const imageSlotIds = (pageId: string): ReadonlySet<string> => {
    const def = pageDefs.get(pageId);
    return new Set(def ? def.slots.filter((s) => s.type === "image").map((s) => s.id) : []);
  };

  // Pass 1 (sync): every distinct asset id referenced by an IMAGE slot
  // anywhere in the doc.
  const assetIds = new Set<string>();
  for (const page of doc.pages) {
    const imageSlots = imageSlotIds(page.page_id);
    for (const [slotId, value] of Object.entries(page.slots)) {
      if (!imageSlots.has(slotId)) continue;
      const m = ASSET_REF.exec(value);
      if (m) assetIds.add(m[1]);
    }
  }

  // Pass 2: fetch each ONCE, in parallel — two slots (even across different
  // pages) picking the same asset produce exactly one file.
  const files: FileMap = {};
  const relPathByAssetId = new Map<string, string>();
  const missing: string[] = [];

  await Promise.all(
    [...assetIds].map(async (assetId) => {
      const loaded = await deps.loadAssetBytes(assetId);
      if (!loaded) {
        missing.push(assetId);
        return;
      }
      const ext = EXT_BY_CONTENT_TYPE[loaded.contentType] ?? "bin";
      const relPath = `img/studio/${assetId}.${ext}`;
      files[relPath] = loaded.bytes;
      relPathByAssetId.set(assetId, relPath);
    }),
  );

  // Pass 3 (sync): rewrite every page's IMAGE slots to their final,
  // depth-correct value; every other slot (including any text slot whose
  // value merely happens to look like a path) is copied verbatim. Never
  // mutates the input — builds new page/slot objects throughout.
  const pages: ContentDocPage[] = doc.pages.map((page) => {
    const imageSlots = imageSlotIds(page.page_id);
    const prefix = relPrefix(depthOf(page));
    const slots: Record<string, string> = {};
    for (const [slotId, value] of Object.entries(page.slots)) {
      if (!imageSlots.has(slotId)) {
        slots[slotId] = value;
        continue;
      }
      const m = ASSET_REF.exec(value);
      if (m) {
        const relPath = relPathByAssetId.get(m[1]);
        // Missing: left exactly as it was ("asset:{uuid}") — the caller
        // (finalize.ts) is the one that turns this into a failed run.
        slots[slotId] = relPath ? prefix + relPath : value;
      } else if (!needsNoPrefix(value)) {
        slots[slotId] = prefix + value;
      } else {
        slots[slotId] = value;
      }
    }
    return { ...page, slots };
  });

  return { doc: { ...doc, pages }, files, missing };
}
