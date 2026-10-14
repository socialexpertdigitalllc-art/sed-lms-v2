import { getDomainDns, parseEmail, suggestEmail } from "@/lib/email-verify";
import { deterministicIssues } from "@/lib/leads/colorScheme";
import { colorDistance, resolveSchemeColors, schemeRoles } from "@/lib/site-builder/palette";
import { safeFetch, UnsafeUrlError } from "../safeFetch";
import type { Problem } from "./types";

/**
 * The checks SED AI runs on what it is about to save — catching the mistakes
 * a form cannot: an email whose domain cannot receive mail, a "Google" link
 * that is really a Yelp page (or does not open), a colour scheme whose two
 * colours are the same blue. SERVER ONLY. Free checks only (DNS, a HEAD
 * request) — never a paid verification provider.
 *
 * A check that cannot tell (DNS timeout, a site that blocks bots) says
 * nothing: only a CERTAIN failure blocks, and a likely one is a warning.
 */

export interface CheckOutput {
  problems: Problem[];
  warnings: string[];
  notes: string[];
}

const empty = (): CheckOutput => ({ problems: [], warnings: [], notes: [] });

export async function checkEmail(field: string, email: string): Promise<CheckOutput> {
  const out = empty();
  const suggestion = suggestEmail(email);
  if (suggestion && suggestion !== email) out.warnings.push(`${email} may be a typo — did the customer mean ${suggestion}?`);
  const domain = parseEmail(email).domain;
  if (!domain) return out;
  try {
    const dns = await Promise.race([getDomainDns(domain), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    if (!dns) return out;
    if (dns.status === "nxdomain") out.problems.push({ field, message: `${email} cannot receive email: the domain ${domain} does not exist. Check the spelling, or say the business has no email.` });
    else if (dns.status === "null_mx" || dns.status === "no_mx_no_addr") {
      out.problems.push({ field, message: `${email} cannot receive email: ${domain} accepts no mail. Check the address, or say the business has no email.` });
    }
  } catch {
    /* DNS unavailable: say nothing */
  }
  return out;
}

const PROFILE_HOSTS: { platform: string; test: RegExp }[] = [
  { platform: "Google", test: /(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|^g\.page$|^share\.google$|^maps\.app\.goo\.gl$/i },
  { platform: "Yelp", test: /(^|\.)yelp\.[a-z.]+$/i },
  { platform: "Facebook", test: /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/i },
];

/** Which listing site a profile link is on, or null for anything else. */
export function profilePlatform(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return PROFILE_HOSTS.find((p) => p.test.test(host))?.platform ?? null;
  } catch {
    return null;
  }
}

export async function checkProfileLink(field: string, url: string, platform: string | null): Promise<CheckOutput> {
  const out = empty();
  const on = profilePlatform(url);
  if (!on) out.warnings.push(`The profile link (${url}) is not a Google Maps or Yelp page — check it is the business's listing.`);
  else if (platform && platform !== "Other" && on !== platform && on !== "Facebook") {
    out.warnings.push(`The platform is ${platform}, but the profile link is a ${on} page.`);
  }
  try {
    const res = await safeFetch(url, { method: "GET", signal: AbortSignal.timeout(5000), headers: { "user-agent": "Mozilla/5.0 (SED AI link check)" } });
    if (res.status === 404 || res.status === 410) out.problems.push({ field, message: `The profile link does not open (the page was not found). Check it.` });
    await res.body?.cancel().catch(() => {});
  } catch (e) {
    // An address inside our own network is refused outright; a site that is
    // slow or blocks bots says nothing.
    if (e instanceof UnsafeUrlError) out.problems.push({ field, message: `The profile link must be a public web page (${e.message})` });
  }
  return out;
}

/** Colour scheme sanity beyond the form's count rule: unrecognisable names, near-identical colours — and what each colour will do on the site. */
export function checkColors(field: string, scheme: string): CheckOutput {
  const out = empty();
  for (const issue of deterministicIssues(scheme)) out.problems.push({ field, message: issue });
  if (out.problems.length) return out;
  const colors = resolveSchemeColors(scheme);
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      if (colorDistance(colors[i], colors[j]) < 0.04) out.warnings.push(`${colors[i]} and ${colors[j]} are almost the same colour — the website will look one-colour.`);
    }
  }
  const roles = schemeRoles(scheme);
  const named = colors.map((c, i) => (roles[i] ? `${roles[i]} ${c}` : null)).filter(Boolean);
  if (named.length) out.notes.push(`Website colours: ${named.join(", ")}.`);
  return out;
}

export function merge(...parts: CheckOutput[]): CheckOutput {
  return {
    problems: parts.flatMap((p) => p.problems),
    warnings: parts.flatMap((p) => p.warnings),
    notes: parts.flatMap((p) => p.notes),
  };
}

/* ------------------------------------------------- pasted listing links */

export interface ListingFacts {
  url: string;
  platform: string | null;
  business_name?: string;
  phone?: string;
  address?: string;
  category?: string;
  website?: string;
  rating?: number;
  reviews?: number;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = re.exec(html) ?? re2.exec(html);
  return m ? decode(m[1]) : undefined;
}

/**
 * What a Google Maps / Yelp / Facebook link says about the business — for
 * filling a lead from a link the agent pasted. Best effort: whatever the page
 * gives without a browser (Yelp's structured data is rich; Google's share
 * links carry the name in the address). The person confirms it all on the
 * card anyway.
 */
export async function readListing(url: string): Promise<ListingFacts> {
  const facts: ListingFacts = { url, platform: profilePlatform(url) };
  let finalUrl = url;
  let html = "";
  try {
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "accept-language": "en-US,en" },
    });
    finalUrl = res.url || url;
    html = (await res.text()).slice(0, 1_500_000);
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw e;
    /* unreachable: work from the link alone */
  }
  facts.url = finalUrl;
  facts.platform = profilePlatform(finalUrl) ?? facts.platform;

  // Google: /maps/place/Jumbo's+Pizza/@…
  const place = /\/maps\/place\/([^/@?]+)/.exec(finalUrl);
  if (place) facts.business_name = decode(decodeURIComponent(place[1].replace(/\+/g, " ")));

  // Structured data (Yelp, many business sites).
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]) as unknown;
      const nodes = (Array.isArray(data) ? data : [data]).flatMap((d) => {
        const g = (d as { "@graph"?: unknown[] })?.["@graph"];
        return Array.isArray(g) ? g : [d];
      }) as Record<string, unknown>[];
      for (const n of nodes) {
        const type = String(n["@type"] ?? "");
        if (!/Business|Restaurant|Store|Service|Organization|Contractor|Plumber|Electrician|Dentist|Place/i.test(type)) continue;
        if (typeof n.name === "string" && !facts.business_name) facts.business_name = decode(n.name);
        if (typeof n.telephone === "string") facts.phone = n.telephone;
        const a = n.address as Record<string, unknown> | string | undefined;
        if (typeof a === "string") facts.address = a;
        else if (a) facts.address = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter((x) => typeof x === "string" && x).join(", ");
        const r = n.aggregateRating as Record<string, unknown> | undefined;
        if (r) {
          if (r.ratingValue !== undefined) facts.rating = Number(r.ratingValue);
          if (r.reviewCount !== undefined) facts.reviews = Number(r.reviewCount);
        }
        if (typeof n.url === "string" && !/yelp\.|google\./i.test(n.url)) facts.website = n.url;
        if (typeof n.servesCuisine === "string") facts.category = n.servesCuisine;
      }
    } catch {
      /* not JSON */
    }
  }

  const title = meta(html, "og:title");
  if (title && !facts.business_name) facts.business_name = title.split(/ · | - | \| /)[0];
  const description = meta(html, "og:description");
  if (description && !facts.address && facts.platform === "Google") facts.address = description.split(" · ")[0];
  if (!facts.phone) {
    const tel = /href=["']tel:([+\d()\-\s.]{10,20})["']/i.exec(html);
    if (tel) facts.phone = tel[1].trim();
  }
  return facts;
}
