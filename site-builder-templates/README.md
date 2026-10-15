# Site Builder templates

Source for Site Builder templates. A template is a zip of static files — `*.html` pages plus
assets — that the Site Builder rewrites page by page for each business. The templates sales
actually pick from live in the `builder-templates` storage bucket and are uploaded on the
**Site Builder → Templates** board; this folder is the editable source for the ones we author
in-house.

| Folder | Look |
| --- | --- |
| [`lumen/`](./lumen) | Modern, airy, 2026-style local-service site: glass header, aurora hero, bento-style cards, scroll reveals, FAQ accordions, lightbox gallery, sticky call-to-action bar on phones. |

## Build and upload

```bash
npm run build:site-template            # builds lumen
npm run build:site-template -- lumen --no-cover   # zip only
```

This writes `site-builder-templates/dist/<name>.zip` and `<name>-cover.png` (git-ignored). The
cover is a 16:10 screenshot of the home page — the ratio the template picker shows — rendered
with Chromium, so it needs `npx playwright install chromium` on a fresh machine.

Upload both on the Templates board (name + zip + cover). A new template is **out of service**
until someone switches it on, so it does not reach the lead form until it has been looked at.

## What a template must do

The Site Builder never analyses a template's HTML. It splits the zip into pages (`.html`) and
assets (everything else), then hands each page whole to the model. Everything below is
therefore a convention the template keeps — and `tests/siteBuilderLumenTemplate.test.ts` runs
the pipeline's own functions over `lumen/` to check it:

- **`components.js`** is the shared-components file (found by name). It is rewritten once per
  run and its source is pasted into **every** page prompt, so it stays small.
- **`SITE_THEME`** inside it marks the base colours with `/* PRIMARY | ACCENT | DARK … */`
  comments. Code (not the model) sets those from the lead's colours, in the lead's order.
  Lumen derives every other shade from the three variables with `color-mix()` and relative
  colours, so one change re-colours the whole site, and text on a brand fill picks black or
  white by the fill's lightness.
- **All CSS is in a cascade layer.** Unlayered CSS beats layered CSS, so the injected theme
  wins whichever file loads first, and anything the model adds on top wins too.
- **Content is data.** Lumen's header, footer, call-to-action and quick bar render from one
  `LUMEN_SITE` object, so the model edits data, not markup. Empty values (no phone, no email,
  no socials, no logo) make the element disappear; nothing throws.
- **Forms** post to the page's own `action` as Web3Forms-style JSON. The access key lives in a
  hidden input and the destination in `action`, never in a script, so the form-relay sweep
  (`rewriteFormTargets`) finds both. Every form has a `botcheck` honeypot.
- **Wordmark ids are kept.** With a client logo, the wordmark text is hidden, never removed:
  other scripts look it up by id.
- **`script.js` never throws on missing markup.** Pages are rewritten and elements removed; a
  single unguarded lookup would stop every behaviour on the site.
- **No external scripts.** The preview CSP allows `'self'` and inline only. Fonts are
  self-hosted (`fonts/`, SIL OFL — licences alongside).
- **Photo slots are plain `<img>` elements** the model can swap. The placeholder art in
  `images/` is transparent on purpose: the slot's brand gradient shows through, so an unfilled
  slot still looks designed in any palette.
- **Icons** are `<i data-i="name">`, drawn by `script.js` from an inline Lucide set (ISC). The
  names are listed in a comment at the top of `components.js`, which is how the model learns
  them; an unknown name falls back to a dot rather than leaving a gap.
- **No claims in the demo copy** — no licences, ratings, guarantees, prices or named
  customers — because the model is told never to invent them and a template that asserts them
  makes that harder. The stats strip uses only facts that come from the brief.

## Editing a template

Edit the files, run the tests (`npx vitest run tests/siteBuilderLumenTemplate.test.ts`), then
rebuild and re-upload. Replacing a template's zip on the board does not touch runs already
generated; the next run built from it uses the new files.
