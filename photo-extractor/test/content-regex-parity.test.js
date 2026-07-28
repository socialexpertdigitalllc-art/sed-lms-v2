import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// content/content.js is a self-contained classic script: some sites (e.g.
// Yelp) enforce a CSP / Trusted Types policy that blocks a content script's
// dynamic import() of extension modules, so it cannot `import` core/url-tools.js
// and instead carries a hand-maintained copy of its Google-photo regexes
// (see the README's "Development" section and the comment at the top of
// content/content.js). Nothing enforces that the copies stay in sync. If they
// drift, photos start being silently dropped or wrongly accepted at the
// toWirePhotos re-validation step (core/capture.js), and neither file's own
// isolated unit tests would ever catch it. This file guards that by reading
// both source files as text and diffing the regex literals themselves.

const __dirname = dirname(fileURLToPath(import.meta.url));
const urlToolsSrc = readFileSync(join(__dirname, '../core/url-tools.js'), 'utf8');
const contentSrc = readFileSync(join(__dirname, '../content/content.js'), 'utf8');

// Reads one JS regex literal starting at `source[slashIndex] === '/'` and
// returns its body (the text between the slashes) and flags. Understands
// character classes (`[...]`) so an unescaped `/` inside one — as in
// `[^=/?#]` — does not get mistaken for the literal's closing slash.
function readRegexLiteralAt(source, slashIndex) {
  let i = slashIndex + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      i += 1;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      i += 1;
      continue;
    }
    if (ch === '/') break;
    i += 1;
  }
  const body = source.slice(slashIndex + 1, i);
  let j = i + 1;
  while (j < source.length && /[a-z]/i.test(source[j])) j += 1;
  const flags = source.slice(i + 1, j);
  return { body, flags };
}

// Finds `const <varName> = /.../flags` (or `let`/`var`) and returns its
// regex body + flags, or null if no such declaration exists in `source`.
function extractNamedRegex(source, varName) {
  const decl = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*/`).exec(source);
  if (!decl) return null;
  const slashIndex = decl.index + decl[0].length - 1;
  return readRegexLiteralAt(source, slashIndex);
}

// The pairs content.js deliberately mirrors from core/url-tools.js (see
// content.js's "---- URL helpers (mirror core/url-tools.js) ----" block).
const MIRRORED_PAIRS = [
  { canonical: 'GOOGLE_HOST_RE', mirror: 'G_HOST' },
  { canonical: 'GOOGLE_TOKEN_RE', mirror: 'G_TOK' },
];

for (const { canonical, mirror } of MIRRORED_PAIRS) {
  test(`content.js's ${mirror} is character-for-character identical to core/url-tools.js's ${canonical}`, () => {
    const canonicalRe = extractNamedRegex(urlToolsSrc, canonical);
    const mirrorRe = extractNamedRegex(contentSrc, mirror);

    assert.ok(
      canonicalRe,
      `Could not find "${canonical}" in core/url-tools.js. If it was renamed, update the ` +
        'MIRRORED_PAIRS list in this test to match.'
    );
    assert.ok(
      mirrorRe,
      `Could not find "${mirror}" in content/content.js. If it was renamed, update the ` +
        'MIRRORED_PAIRS list in this test to match.'
    );

    assert.deepEqual(
      mirrorRe,
      canonicalRe,
      `content/content.js's ${mirror} has drifted from core/url-tools.js's ${canonical}.\n\n` +
        'content.js inlines its own copy of these regexes instead of importing core/url-tools.js ' +
        "because it must run as a self-contained classic script — some sites' CSP / Trusted " +
        "Types policy blocks a content script's dynamic import() of extension modules. That means " +
        'nothing but this test keeps the two copies in sync: if they disagree, photos start being ' +
        'silently dropped or wrongly accepted at the toWirePhotos re-validation step, and neither ' +
        "file's own isolated unit tests would notice.\n\n" +
        `To fix this: update the inline "${mirror}" definition in content/content.js (in its ` +
        '"---- URL helpers (mirror core/url-tools.js) ----" block) so its pattern and flags match ' +
        `"${canonical}" in core/url-tools.js exactly.`
    );
  });
}
