# Desktop & phone notifications (Web Push) — runbook

Added 2026-10-20. Everything the notification bell shows is also pushed to each
browser/phone where that person turned notifications on, so they hear about it
with the LMS closed.

## For users

- **Turn on:** the "Don't miss urgent updates" card (bottom-left, asks at most
  once a week) or **Notifications → Desktop & phone notifications → Turn on**.
  Per browser: each computer/phone is turned on separately.
- **Send a test** on the same card checks the whole chain.
- **Blocked?** Lock icon next to the address bar → Notifications → Allow, reload.
- **iPhone/iPad:** Safari → Share → *Add to Home Screen*, open the LMS from the
  Home Screen, then turn notifications on there (Apple only allows push for
  Home Screen apps, iOS 16.4+). Android Chrome works directly.
- Urgent events (follow-up reminders, ticket assigned/overdue, client site
  down, contract send failed, AI run failed, agency-website lead —
  `URGENT_EVENTS` in lib/notifications/events.ts) stay on screen until clicked.
- Clicking opens the LMS on the right page and marks the notification read.
- Signing out stops pushes to that browser.

## How it works

- `public/push-sw.js` — a service worker that only shows notifications and
  handles clicks. No fetch handler, no caching.
- `push_subscriptions` (migration 0088) — one row per browser; service-role
  only. Endpoints must be a real browser push service (lib/push/endpoint.ts).
- `lib/push/dispatch.ts` — pushes every `notifications` row once it is due
  (`deliver_after`), claiming it via `pushed_at` so nothing is sent twice.
  notify() kicks it immediately; prod polls `/api/push/dispatch` every 30s
  for everything else (delayed reminders, rows inserted elsewhere). Rows read
  in the app, or due more than 2h ago, are claimed but not sent. More than 3
  non-urgent pushes for one person in one pass collapse into one summary.
- Dead devices (push service 404/410) are deleted automatically.

## Keys

The VAPID key pair is generated on first use and stored in
`app_settings.push_vapid` (private key encrypted with `MAILBOX_ENC_KEY`).
To pin your own instead, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
optionally `VAPID_SUBJECT` (https URL or mailto:) — env wins. Changing the
pair invalidates every browser's subscription (people turn it on again).
Never rotate it casually.

## Troubleshooting

- Card missing entirely → the server isn't ready: migration 0088 not applied,
  or `MAILBOX_ENC_KEY` missing on the server.
- "The test didn't reach any device" → turn off and on again on that browser.
- Nothing arrives on Windows → Windows Settings → Notifications: allow the
  browser; Focus assist / Do not disturb hides them.
