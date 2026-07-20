/**
 * Typo suggestions. Returns a SUGGESTION ONLY — callers must never
 * auto-correct what a human typed.
 *
 * The TLD is weighted separately from the domain name, because the two typo
 * classes are independent: `gmial.com` (transposed name, correct TLD) and
 * `gmail.con` (correct name, fat-fingered TLD) both happen, and so does
 * `gmial.con`. The `.com` family (`.con` / `.cm` / `.co` / `.ocm` / `.xom`) is
 * by far the highest-yield class, so it gets an explicit table.
 */

/** Popular mail domains we are willing to fuzzy-correct towards (length >= 5). */
const FUZZY_TARGETS = [
  "gmail",
  "yahoo",
  "hotmail",
  "outlook",
  "icloud",
  "googlemail",
  "protonmail",
  "comcast",
  "yandex",
  "rocketmail",
  "btinternet",
  "sbcglobal",
];

/** Free-mail second-level domains — used to decide whether `.co` means `.com`. */
export const POPULAR_SLDS = new Set([
  ...FUZZY_TARGETS,
  "aol",
  "live",
  "msn",
  "mail",
  "gmx",
  "zoho",
  "me",
  "web",
  "ymail",
  "att",
  "cox",
]);

/**
 * Real domains that are within edit-distance 1 of a popular one. Without this
 * guard, `mail.com` would be "corrected" to `gmail.com` and `email.com` too.
 */
const KNOWN_VALID_SLDS = new Set([
  "mail",
  "email",
  "gmx",
  "aim",
  "icloud",
  "cloud",
  "gmail",
  "yahoo",
  "hotmail",
  "outlook",
  "yandex",
  "comcast",
]);

/** Explicit, high-frequency misspellings of the domain name itself. */
const SLD_TYPOS: Record<string, string> = {
  gmial: "gmail",
  gmai: "gmail",
  gmal: "gmail",
  gmaill: "gmail",
  gnail: "gmail",
  gamil: "gmail",
  gmial1: "gmail",
  hotmial: "hotmail",
  hotmai: "hotmail",
  hotmil: "hotmail",
  homail: "hotmail",
  hotamil: "hotmail",
  outlok: "outlook",
  outllok: "outlook",
  outook: "outlook",
  outlool: "outlook",
  yaho: "yahoo",
  yahou: "yahoo",
  yahooo: "yahoo",
  yhoo: "yahoo",
  icloud1: "icloud",
  iclod: "icloud",
  icould: "icloud",
};

/** Explicit TLD corrections. `.co` is handled separately — it is a real ccTLD. */
const TLD_TYPOS: Record<string, string> = {
  con: "com",
  cno: "com",
  cmo: "com",
  ocm: "com",
  xom: "com",
  vom: "com",
  comm: "com",
  cim: "com",
  clm: "com",
  cm: "com",
  om: "com",
  ney: "net",
  nte: "net",
  ner: "net",
  ogr: "org",
  orgg: "org",
};

/** Optimal string alignment distance (Levenshtein + adjacent transposition). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

function correctSld(sld: string): string {
  if (SLD_TYPOS[sld]) return SLD_TYPOS[sld];
  if (KNOWN_VALID_SLDS.has(sld)) return sld;
  if (sld.length < 4) return sld;
  for (const target of FUZZY_TARGETS) {
    if (Math.abs(target.length - sld.length) > 1) continue;
    if (editDistance(sld, target) === 1) return target;
  }
  return sld;
}

function correctTld(tld: string, sld: string, labelCount: number): string {
  if (TLD_TYPOS[tld]) return TLD_TYPOS[tld];
  // `.co` is a legitimate ccTLD (and `example.co.uk` is not even a `.co` TLD),
  // so only treat it as a truncated `.com` on a two-label free-mail domain.
  if (tld === "co" && labelCount === 2 && POPULAR_SLDS.has(sld)) return "com";
  return tld;
}

/**
 * Suggest a corrected domain, or null when nothing looks wrong.
 * Input is expected lowercased (parseEmail already lowercases the domain).
 */
export function suggestDomain(domain: string): string | null {
  const lower = (domain ?? "").trim().toLowerCase();
  if (!lower || !lower.includes(".")) return null;
  const labels = lower.split(".");
  if (labels.some((l) => l === "")) return null;

  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const prefix = labels.slice(0, -2);

  const newSld = correctSld(sld);
  const newTld = correctTld(tld, newSld, labels.length);
  if (newSld === sld && newTld === tld) return null;
  return [...prefix, newSld, newTld].join(".");
}

/**
 * Suggest a corrected full address, or null. The local-part is never touched.
 */
export function suggestEmail(email: string): string | null {
  const raw = (email ?? "").trim();
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return null;
  const localPart = raw.slice(0, at);
  const domain = raw.slice(at + 1).toLowerCase();
  const fixed = suggestDomain(domain);
  return fixed ? `${localPart}@${fixed}` : null;
}
