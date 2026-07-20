/**
 * Curated static lists. Deliberately small and hand-picked rather than a
 * 100k-entry dump: these only produce WARNs, and a stale mega-list costs more
 * in false positives than it buys.
 */

/**
 * Privacy relays / aliasing services. These forward to a real mailbox, so they
 * are NEVER disposable — flagging an Apple "Hide My Email" address as throwaway
 * would be wrong in the one direction that loses us a real lead.
 * Checked BEFORE the disposable list, and it wins.
 */
export const PRIVACY_RELAY_DOMAINS = new Set([
  // Apple Hide My Email
  "privaterelay.appleid.com",
  "icloud.com",
  // Firefox Relay
  "relay.firefox.com",
  "mozmail.com",
  // DuckDuckGo Email Protection
  "duck.com",
  // SimpleLogin (Proton)
  "simplelogin.com",
  "simplelogin.io",
  "simplelogin.fr",
  "slmail.me",
  "aleeas.com",
  "8alias.com",
  // AnonAddy / addy.io
  "anonaddy.com",
  "anonaddy.me",
  "addy.io",
  // Proton pass aliases
  "passmail.net",
  "passinbox.com",
]);

/** Known throwaway / 10-minute mail providers. */
export const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "airmail.cc",
  "armyspy.com",
  "byom.de",
  "cuvox.de",
  "dayrep.com",
  "discard.email",
  "dispostable.com",
  "einrot.com",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemail.net",
  "fleckens.hu",
  "gomail.in",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "inboxbear.com",
  "inboxkitten.com",
  "jetable.org",
  "mailcatch.com",
  "maildrop.cc",
  "mailexpire.com",
  "mailforspam.com",
  "mailinator.com",
  "mailnesia.com",
  "mailsac.com",
  "mailtemp.net",
  "mintemail.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "nowmymail.com",
  "pokemail.net",
  "rhyta.com",
  "sharklasers.com",
  "spam4.me",
  "spambog.com",
  "spamgourmet.com",
  "superrito.com",
  "teleworm.us",
  "temp-mail.io",
  "temp-mail.org",
  "tempinbox.com",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "trbvm.com",
  "vomoto.com",
  "wegwerfmail.de",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "zetmail.com",
]);

/**
 * RFC 2142 mailbox names (plus the handful of universally-used extras). These
 * are shared/departmental inboxes, not people — a WARN, never a block.
 */
export const ROLE_NAMES = new Set([
  "info",
  "sales",
  "support",
  "admin",
  "billing",
  "contact",
  "help",
  "marketing",
  "abuse",
  "noc",
  "security",
  "postmaster",
  "hostmaster",
  "webmaster",
]);

/** Common consumer mailbox providers — informational only, never a warning. */
export const FREE_PROVIDER_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "gmx.com",
  "gmx.de",
  "hotmail.co.uk",
  "hotmail.com",
  "hotmail.fr",
  "icloud.com",
  "live.com",
  "mail.com",
  "mail.ru",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "yahoo.co.uk",
  "yahoo.com",
  "yandex.com",
  "yandex.ru",
  "ymail.com",
  "zoho.com",
]);

function lower(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

/** Whitelisted relays are never disposable. */
export function isPrivacyRelay(domain: string): boolean {
  return PRIVACY_RELAY_DOMAINS.has(lower(domain));
}

export function isDisposable(domain: string): boolean {
  const d = lower(domain);
  if (!d) return false;
  if (isPrivacyRelay(d)) return false;
  return DISPOSABLE_DOMAINS.has(d);
}

/**
 * RFC 2142 role mailbox. Sub-addressing is stripped (`sales+eu@` is still
 * `sales@`) and the comparison is case-insensitive.
 */
export function isRoleAccount(localPart: string): boolean {
  const base = lower(localPart).split("+")[0];
  return ROLE_NAMES.has(base);
}

/**
 * `postmaster@` is required to exist on every mail-accepting domain (RFC 5321
 * §4.5.1), so it must never be reported as invalid — the verdict engine keys
 * off this.
 */
export function isRequiredMailbox(localPart: string): boolean {
  return lower(localPart).split("+")[0] === "postmaster";
}

export function isFreeProvider(domain: string): boolean {
  return FREE_PROVIDER_DOMAINS.has(lower(domain));
}
