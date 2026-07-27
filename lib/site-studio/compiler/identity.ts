import { HTMLElement, TextNode } from "node-html-parser";
import { Diagnostic } from "../schema";
import { BRAND_TOKEN, findTokens, idToken } from "../tokens";
import { Inventory } from "./inventory";

const PHONE_RE = /(?:\+1[-. ]?)?(?:\(\d{3}\)\s?|\d{3}[-. ])\d{3}[-. ]\d{4}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const YEAR_RE = /(©|&copy;)\s*(20\d\d)(?:\s*[-–—]\s*(20\d\d))?/;

function mostFrequent(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const GOOGLE_HOSTS = new Set(["google.com", "www.google.com", "maps.google.com", "g.page", "goo.gl", "maps.app.goo.gl", "business.google.com"]);

/** True when `src` parses as an absolute http(s) URL on a recognized Google
 *  host — used to find a Business Profile / reviews iframe (Task 6) as
 *  distinct from an arbitrary third-party embed. Fails safe (false) for a
 *  relative path, a template token already substituted in, or garbage. */
function isGoogleHost(src: string): boolean {
  try {
    const u = new URL(src);
    return (u.protocol === "http:" || u.protocol === "https:") && GOOGLE_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const BRAND_LANDMARK_TAGS = new Set(["header", "footer"]);
const BRAND_HOOK_RE = /\b(logo|brand)\b/i;
const BRAND_SKIP = new Set(["script", "style", "noscript", "template", "title", "head", "html", "body", "header", "footer", "nav"]);

function withinBrandLandmark(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el;
  while (cur) {
    if (BRAND_LANDMARK_TAGS.has(cur.rawTagName?.toLowerCase() ?? "")) return true;
    cur = cur.parentNode as HTMLElement | null;
  }
  return false;
}

/**
 * Pass 2c: the site's BRAND element (Phase 4c, Task 5) — a header/footer
 * wordmark the renderer can swap a client logo <img> into, falling back to
 * the business name when no logo is supplied (tokens.ts's BRAND_TOKEN,
 * render/renderer.ts). Runs BEFORE the business-name literal replace below
 * so it sees the ORIGINAL demo text, and so a candidate it claims is
 * naturally excluded from that later pass (its content is already gone).
 *
 * Detection is deliberately narrow — a false positive rewrites the wrong
 * element on every page of every site. A candidate must be:
 *   - a LEAF (no element children — a wrapper that also holds unrelated
 *     content is never swallowed whole);
 *   - inside a <header> or <footer> landmark (the literal product
 *     requirement: "use this in the header and footer");
 *   - carrying non-empty own text; and EITHER
 *     - an id/class naming it as a logo/brand element (the plumberpro/
 *       gearhead fixture shape, `<a class="logo">Business Name</a>`), OR
 *     - its complete text case-insensitively equal to the detected business
 *       name or its first word — a stylized short wordmark like
 *       "NORTHPOINT" for "Northpoint Remodeling", the exact case that
 *       motivated this pass: the plain business-name literal match never
 *       fires there (it isn't a substring match, the word is truncated),
 *       and <span> is inline so the ordinary text-slot pass never reaches
 *       it either (compiler/slots.ts's isSlottableLeaf).
 *
 * Every match must carry BYTE-IDENTICAL text to the first one found — the
 * renderer's no-logo fallback can only reproduce ONE captured sample. A
 * later candidate whose text differs is left untouched (not guessed at)
 * and reported via identity_brand_mismatch.
 */
function extractBrand(
  pages: Inventory["pages"], businessName: string,
): { sample?: string; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (!businessName) return { diagnostics };

  const words = businessName.split(/\s+/).filter(Boolean);
  const nameMatches = new Set([businessName.toLowerCase()]);
  if (words.length > 1) nameMatches.add(words[0].toLowerCase());

  let sample: string | undefined;
  let matchCount = 0;
  for (const page of pages) {
    for (const el of page.root.querySelectorAll("*")) {
      const tag = el.rawTagName?.toLowerCase() ?? "";
      if (!tag || BRAND_SKIP.has(tag)) continue;
      if (el.querySelectorAll("*").length > 0) continue; // leaf only
      if (!withinBrandLandmark(el)) continue;

      const text = el.text.trim();
      if (!text || findTokens(text).length > 0) continue; // empty (decorative) or already tokenized

      const idCls = `${el.getAttribute("id") ?? ""} ${el.getAttribute("class") ?? ""}`;
      const hasHook = BRAND_HOOK_RE.test(idCls);
      const isNameMatch = nameMatches.has(text.toLowerCase());
      if (!hasHook && !isNameMatch) continue;

      if (sample === undefined) sample = text;
      if (text !== sample) {
        diagnostics.push({
          level: "warn",
          code: "identity_brand_mismatch",
          page: page.file,
          message: `A second brand-like element ("${text}") does not match the first captured brand text ("${sample}") — left untouched; a client logo will only replace the first.`,
        });
        continue;
      }

      el.set_content(BRAND_TOKEN);
      matchCount++;
    }
  }

  if (sample !== undefined) {
    diagnostics.push({
      level: "info",
      code: "identity_brand_detected",
      message: `Brand element detected (demo text "${sample}") and tokenized at ${matchCount} location(s) — a client logo image will replace it when supplied, otherwise the client's business name renders in its place.`,
    });
  }

  return { sample, diagnostics };
}

function replaceEverywhere(pages: Inventory["pages"], value: string, token: string, wordBounded: boolean) {
  const re = new RegExp(
    wordBounded ? `(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])` : escapeRe(value), "g",
  );
  for (const page of pages) {
    for (const el of [page.root, ...page.root.querySelectorAll("*")]) {
      for (const node of el.childNodes) {
        if (node instanceof TextNode && re.test(node.rawText)) node.rawText = node.rawText.replace(re, token);
        re.lastIndex = 0;
      }
      if (el instanceof HTMLElement) {
        for (const [attr, v] of Object.entries(el.attributes)) {
          if (re.test(v)) el.setAttribute(attr, v.replace(re, token));
          re.lastIndex = 0;
        }
      }
    }
  }
}

/** Pass 2 (deterministic subset): tokenize phone/email/map/name/year in text + attributes. */
export function extractIdentity(
  inv: Inventory,
): { identity: Record<string, string>; diagnostics: Diagnostic[]; brand?: { sample: string } } {
  const diagnostics: Diagnostic[] = [];
  const identity: Record<string, string> = {};
  const allText = inv.pages.map((p) => p.root.toString()).join("\n");

  const phoneMatches = allText.match(PHONE_RE) ?? [];
  const distinctPhones = [...new Set(phoneMatches)];
  const phone = mostFrequent(phoneMatches);
  if (phone) {
    identity.phone = phone;
    if (distinctPhones.length > 1) {
      diagnostics.push({
        level: "warn",
        code: "identity_phone_multiple",
        message: `Multiple phone numbers found; kept "${phone}", dropped: ${distinctPhones.filter((p) => p !== phone).join(", ")}`,
      });
    }

    // Discover actual tel: hrefs from the DOM (mirror the map-iframe scan below) —
    // a synthesized tel: href never matches a real one written in a different format
    // (e.g. E.164), so prefer whatever the template actually uses.
    const telHrefs: string[] = [];
    for (const page of inv.pages) {
      for (const a of page.root.querySelectorAll("a")) {
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("tel:") && !telHrefs.includes(href)) telHrefs.push(href);
      }
    }
    if (telHrefs.length > 0) {
      identity.phone_href = telHrefs[0];
      for (const href of telHrefs) replaceEverywhere(inv.pages, href, idToken("phone_href"), false);
    } else {
      identity.phone_href = `tel:${phone.replace(/[^\d+]/g, "")}`;
    }
    replaceEverywhere(inv.pages, phone, idToken("phone"), false);
  }

  const emailMatches = allText.match(EMAIL_RE) ?? [];
  const distinctEmails = [...new Set(emailMatches)];
  const email = mostFrequent(emailMatches);
  if (email) {
    identity.email = email;
    if (distinctEmails.length > 1) {
      diagnostics.push({
        level: "warn",
        code: "identity_email_multiple",
        message: `Multiple email addresses found; kept "${email}", dropped: ${distinctEmails.filter((e) => e !== email).join(", ")}`,
      });
    }
    replaceEverywhere(inv.pages, `mailto:${email}`, idToken("email_href"), false);
    identity.email_href = `mailto:${email}`;
    replaceEverywhere(inv.pages, email, idToken("email"), false);
  }

  for (const page of inv.pages) {
    const iframe = page.root.querySelectorAll("iframe").find((f) => (f.getAttribute("src") ?? "").includes("google.com/maps"));
    if (iframe && !identity.map_embed) identity.map_embed = iframe.getAttribute("src")!;
  }
  if (identity.map_embed) replaceEverywhere(inv.pages, identity.map_embed, idToken("map_embed"), false);

  // Pass 2b (Phase 4c, Task 6): a SEPARATE Google iframe — the client's
  // Business Profile / reviews widget, never the map — tokenized as
  // {{id:profile_embed}}. Distinguished from the map purely by pointing at
  // a DIFFERENT src: the locked operator decision is that the map iframe
  // always keeps using map_embed_link, so any OTHER Google iframe found is
  // the profile embed — never a substitute for, or folded into, the map.
  for (const page of inv.pages) {
    const iframe = page.root.querySelectorAll("iframe").find((f) => {
      const src = f.getAttribute("src") ?? "";
      return !!src && src !== identity.map_embed && isGoogleHost(src);
    });
    if (iframe && !identity.profile_embed) identity.profile_embed = iframe.getAttribute("src")!;
  }
  if (identity.profile_embed) replaceEverywhere(inv.pages, identity.profile_embed, idToken("profile_embed"), false);

  const home = inv.pages.find((p) => p.kind === "home") ?? inv.pages[0];
  const title = home?.root.querySelector("title")?.text ?? "";
  const name = title.split(/[|\-–—]/)[0].trim();
  let brand: { sample: string } | undefined;
  if (name.length >= 3) {
    identity.business_name = name;

    // Brand-block detection (Phase 4c, Task 5) runs BEFORE the literal
    // business-name replace just below, so it captures the ORIGINAL demo
    // text at a candidate element (which may not literally equal `name` —
    // see extractBrand's doc comment) before that text is gone.
    const brandResult = extractBrand(inv.pages, name);
    diagnostics.push(...brandResult.diagnostics);
    if (brandResult.sample !== undefined) brand = { sample: brandResult.sample };

    replaceEverywhere(inv.pages, name, idToken("business_name"), true);
    diagnostics.push({
      level: "warn", code: "identity_name_heuristic",
      message: `Business name "${name}" detected from the home <title>; AI/name review lands in Phase 2 — verify in review.`,
    });
  } else {
    diagnostics.push({ level: "warn", code: "identity_name_missing", message: "No business name detected from <title>" });
  }

  const yearMatch = allText.match(YEAR_RE);
  if (yearMatch) {
    if (yearMatch[3]) {
      identity.year = yearMatch[3];
      replaceEverywhere(inv.pages, yearMatch[3], idToken("year"), true);
      diagnostics.push({
        level: "warn",
        code: "identity_year_range",
        message: `Copyright year range "${yearMatch[2]}-${yearMatch[3]}" detected; tokenized the end year only, start year "${yearMatch[2]}" left raw — verify in review.`,
      });
    } else {
      identity.year = yearMatch[2];
      replaceEverywhere(inv.pages, yearMatch[2], idToken("year"), true);
    }
  }

  return { identity, diagnostics, brand };
}
