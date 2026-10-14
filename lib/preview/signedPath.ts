// lib/preview/signedPath.ts
/** The signed preview addresses, kept free of node imports so the session
 *  middleware can match them (see lib/preview/signedPreview.ts). The route
 *  behind each one checks its token itself, and falls back to the session
 *  when the token isn't valid, so the middleware lets these through. */
export const SIGNED_PREVIEW_PATH =
  /^\/api\/(?:site-agent\/runs|site-builder\/runs|site-builder\/templates)\/[^/]+\/preview\/~[^/]+(?:\/|$)/;
