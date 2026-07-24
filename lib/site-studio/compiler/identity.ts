import { HTMLElement, TextNode } from "node-html-parser";
import { Diagnostic } from "../schema";
import { idToken } from "../tokens";
import { Inventory } from "./inventory";

const PHONE_RE = /(?:\(\d{3}\)\s?|\d{3}[-. ])\d{3}[-. ]\d{4}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const YEAR_RE = /(©|&copy;)\s*(20\d\d)/;

function mostFrequent(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
export function extractIdentity(inv: Inventory): { identity: Record<string, string>; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const identity: Record<string, string> = {};
  const allText = inv.pages.map((p) => p.root.toString()).join("\n");

  const phone = mostFrequent(allText.match(PHONE_RE) ?? []);
  if (phone) {
    identity.phone = phone;
    identity.phone_href = `tel:${phone.replace(/[^\d+]/g, "")}`;
    replaceEverywhere(inv.pages, identity.phone_href, idToken("phone_href"), false);
    replaceEverywhere(inv.pages, phone, idToken("phone"), false);
  }

  const email = mostFrequent(allText.match(EMAIL_RE) ?? []);
  if (email) {
    identity.email = email;
    replaceEverywhere(inv.pages, `mailto:${email}`, idToken("email_href"), false);
    identity.email_href = `mailto:${email}`;
    replaceEverywhere(inv.pages, email, idToken("email"), false);
  }

  for (const page of inv.pages) {
    const iframe = page.root.querySelectorAll("iframe").find((f) => (f.getAttribute("src") ?? "").includes("google.com/maps"));
    if (iframe && !identity.map_embed) identity.map_embed = iframe.getAttribute("src")!;
  }
  if (identity.map_embed) replaceEverywhere(inv.pages, identity.map_embed, idToken("map_embed"), false);

  const home = inv.pages.find((p) => p.kind === "home") ?? inv.pages[0];
  const title = home?.root.querySelector("title")?.text ?? "";
  const name = title.split(/[|\-–—]/)[0].trim();
  if (name.length >= 3) {
    identity.business_name = name;
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
    identity.year = yearMatch[2];
    replaceEverywhere(inv.pages, yearMatch[2], idToken("year"), true);
  }

  return { identity, diagnostics };
}
