# Site health: "Bot check" — runbook

Added 2026-10-21. From 2026-10-20 21:57 UTC, the LMS sent ~40 "Site down"
alerts for healthy sites on the Hostinger account that holds the client sites
(u447231526, server 76.13.203.71). The sites were up. Hostinger's bot
protection was answering the LMS's site checker with a robot check instead of
the page:

- **LiteSpeed (the web server):** HTTP 403, a page titled *Bot Verification*
  that says "Verifying that you are not a robot..." (an invisible reCAPTCHA).
- **Hostinger's CDN:** "Checking your browser before accessing … Please wait
  for up to 5 seconds".

A browser passes either check on its own. A script like our checker can't, and
must not try to.

## What the LMS does now

- A check that gets one of these pages (or a Cloudflare challenge) is marked
  **Bot check**, not **Site down**. The summary says who put the check up.
- A Bot check is not a failure. It sends no alert and breaks a failure streak.
  It is left out of uptime %, like Parked and No DNS: the page behind the check
  wasn't measured.
- A real error page is still **Site down**. That includes a plain "403
  Forbidden", e.g. a site with no `index.html`.
- Go-live (moving a site onto its domain) counts a bot check as "the domain is
  being served", so it no longer says "still provisioning".

## If many sites show Bot check

1. **Check as a visitor.** Open two or three of the sites on a phone using
   mobile data, not the office Wi-Fi. If they load, visitors are fine.
2. **Ask Hostinger to stop challenging the LMS.** Use hPanel live chat for the
   client-sites plan and ask them to allowlist the LMS server's IP in the bot
   protection (LiteSpeed reCAPTCHA and the CDN) for that account. The LMS runs
   on the other plan, `lms.sedsolutions.online`. Ask Hostinger for that
   server's outgoing IP if it isn't on the plan page. If the office team sees
   the robot page too, have the office IP allowlisted as well.
3. **If the sites are also slow** (Bot check or Site down with answers of 5–15
   s, or timeouts), the server is short of resources. The protection switches
   on under load. That plan holds about 190 sites: 112 static, 71 WordPress
   and 7 Node.js apps. Check the plan's resource usage page in hPanel. Move the
   Node.js apps or the busiest WordPress sites to the other plan, or upgrade.

## How it works

- `lib/domains/botCheck.ts`: `detectBotChallenge` (pure) recognises the pages.
  `botChallengeOf` reads at most the first 32 KB of an error answer.
- `lib/domains/health.ts`: `probeSite` records `http.challenge`.
  `classifyHealth` turns it into the `challenged` state.
- `health_state` is plain text, so no migration was needed. The uptime SQL
  (`client_domain_uptime*`) already counts only up/down/ssl_error.
