// lib/domains/botCheck.ts — tell a host's bot check apart from the site's own
// answer. Hostinger (and others) can put a robot check in front of a site:
// its servers (LiteSpeed) answer 403 "Bot Verification" with an invisible
// reCAPTCHA, its CDN answers "Checking your browser before accessing…", and
// Cloudflare marks its challenges with `cf-mitigated: challenge`. A browser
// passes these on its own; a script like our site checker can't (and mustn't
// try to). So such an answer means "the host is serving this domain and is
// screening visitors", never "the site is down".

export type BotChallenge = "litespeed" | "hostinger_cdn" | "cloudflare";

/** Who put the check up, in words for the UI. */
export const BOT_CHALLENGE_WHO: Record<BotChallenge, string> = {
  litespeed: "The web server",
  hostinger_cdn: "Hostinger's CDN",
  cloudflare: "Cloudflare",
};

/** Challenge pages are small; nothing past this is downloaded. */
const SNIFF_BYTES = 32_768;

/** Pure: the bot check this answer is, or null for a real answer. Tested. */
export function detectBotChallenge(status: number, headers: Headers, body: string): BotChallenge | null {
  if (headers.get("cf-mitigated")?.toLowerCase() === "challenge") return "cloudflare";
  if (status < 400) return null;
  if (/lsrecaptcha|\/\.lsrecap\/|<title>\s*Bot Verification\s*<\/title>/i.test(body)) return "litespeed";
  if (/Checking your browser before accessing/i.test(body)) return "hostinger_cdn";
  return null;
}

/** The first few KB of a response as text. Always releases the body. */
async function readHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < SNIFF_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    // a body cut off part-way still gives what arrived
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, SNIFF_BYTES));
}

/**
 * The bot check this response is, if any. Only an error answer (or one
 * Cloudflare marks) is read, and only its first 32 KB; every body is released.
 */
export async function botChallengeOf(res: Response): Promise<BotChallenge | null> {
  if (res.status < 400 && !res.headers.has("cf-mitigated")) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  return detectBotChallenge(res.status, res.headers, await readHead(res));
}
