/**
 * The platform a business profile link is on, from its domain — so the agent
 * pastes the link and the Platform field fills itself.
 *
 *   maps.google.com/…, google.com/maps/…, g.page/…, maps.app.goo.gl/… → Google
 *   yelp.com/biz/…, m.yelp.com/…                                       → Yelp
 *   anything else: the main domain's name — xyz.abc.com → "Abc",
 *   facebook.com → "Facebook", angi.com → "Angi"
 *
 * Subdomains never decide it (maps.google.com is Google, not "Maps"), and
 * two-part country endings count as one (yelp.co.uk is Yelp).
 */

/** Two-part public endings, so the name is read from the label before them. */
const TWO_PART_ENDINGS = new Set([
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "co.nz", "org.nz", "co.za", "com.br", "com.mx",
  "co.in", "co.jp", "co.kr", "com.sg", "com.my", "com.ph", "com.pk", "com.tr",
  "com.ar", "com.co", "com.hk", "com.tw", "com.cn", "co.il", "com.sa", "com.eg",
]);

/** Domains that belong to a platform under a different name (short links, sister domains). */
const DOMAIN_PLATFORM: Record<string, string> = {
  "goo.gl": "Google",
  "g.page": "Google",
  "g.co": "Google",
  "google": "Google",
  "yelp": "Yelp",
  "fb.com": "Facebook",
  "fb.me": "Facebook",
  "instagr.am": "Instagram",
  "youtu.be": "YouTube",
  "lnkd.in": "LinkedIn",
  "x.com": "X",
  "twitter.com": "X",
  "t.co": "X",
};

/** How a platform's name is written, where plain capitalisation would be wrong. */
const NAME_CASE: Record<string, string> = {
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  homeadvisor: "HomeAdvisor",
  yellowpages: "YellowPages",
  mapquest: "MapQuest",
  tripadvisor: "Tripadvisor",
  bbb: "BBB",
  houzz: "Houzz",
  nextdoor: "Nextdoor",
  thumbtack: "Thumbtack",
  facebook: "Facebook",
  instagram: "Instagram",
  pinterest: "Pinterest",
  angi: "Angi",
  angieslist: "Angi",
  apple: "Apple",
  bing: "Bing",
  porch: "Porch",
  manta: "Manta",
  foursquare: "Foursquare",
  waze: "Waze",
};

/** The host name of a link, lowercased, without "www." — or null when it isn't a link. */
export function linkHost(link: string): string | null {
  const raw = link.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\d*\./, "").replace(/\.$/, "");
  // A real domain: at least "name.ending", letters/digits/hyphens.
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return null;
  return host;
}

/** The main domain of a host: abc.com for xyz.abc.com, yelp.co.uk for m.yelp.co.uk. */
export function mainDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  return TWO_PART_ENDINGS.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

/** The platform's display name for a profile link, or null when the link has no usable domain. */
export function platformFromLink(link: string): string | null {
  const host = linkHost(link);
  if (!host) return null;
  const main = mainDomain(host);
  // Short links and sister domains first (maps.app.goo.gl → goo.gl → Google).
  if (DOMAIN_PLATFORM[host]) return DOMAIN_PLATFORM[host];
  if (DOMAIN_PLATFORM[main]) return DOMAIN_PLATFORM[main];
  const name = main.split(".")[0];
  // Every Google / Yelp country domain (google.co.uk, yelp.ca …).
  if (DOMAIN_PLATFORM[name]) return DOMAIN_PLATFORM[name];
  if (NAME_CASE[name]) return NAME_CASE[name];
  return name.charAt(0).toUpperCase() + name.slice(1);
}
