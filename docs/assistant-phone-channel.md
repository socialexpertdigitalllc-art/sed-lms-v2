# SED AI on the phone — Telegram and WhatsApp

People link their own Telegram chat or WhatsApp number to their SED AI and
talk to it from there: ask anything, or ask it to do something and reply
**YES** to confirm. Everything runs as that person, with their permissions:
the same answers, the same proposals, the same checks as in the app.

## Before you start

1. **Migration 0087** (`supabase/migrations/0087_assistant_actions.sql`) must be
   applied. It has the `assistant_channel_links` and `assistant_link_codes` tables.
2. **The two webhook paths must be public.** `lib/supabase/middleware.ts` sends
   every request without a session to `/login`, and Telegram and Meta have no
   session. Add them to `isPublic` there, next to `/api/forms/submit`:
   ```ts
   path === "/api/assistant/channels/telegram" ||
   path === "/api/assistant/channels/whatsapp" ||
   ```
   Both authenticate the platform themselves (Telegram's secret token, Meta's
   signature). Until this is done, Telegram's `getWebhookInfo` shows
   `Wrong response from the webhook: 307`.
3. **`APP_PUBLIC_URL`**: the public https address of the app, for example
   `https://lms.example.com` (no trailing slash). Links in phone replies are
   built on it. Without it they fall back to `WGE_SELF_ORIGIN`, which is often
   an internal address.
4. The server must be reachable over **https with a valid certificate**. Both
   platforms refuse anything else.

Set the variables in the server environment (`.env.local` on the box), then
restart the app. A channel appears in the app only when **all** of its
variables are set.

## Telegram

1. In Telegram, open **@BotFather** and send `/newbot`. Pick a display name and
   a username ending in `bot`. BotFather replies with the token.
   - `TELEGRAM_BOT_TOKEN` = that token
   - `TELEGRAM_BOT_USERNAME` = the username, without the `@`
2. Make a webhook secret (letters, digits, `_` and `-`, up to 256 characters):
   ```sh
   openssl rand -hex 32
   ```
   - `TELEGRAM_WEBHOOK_SECRET` = the output
3. Optional but recommended: in @BotFather, `/setjoingroups` → **Disable**.
   SED AI only answers private chats and ignores groups anyway.
4. Restart the app with the variables set, then register the webhook. Run this
   in a shell where the variables are loaded, so the token does not end up in
   your shell history or a ticket:
   ```sh
   curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     -d "url=${APP_PUBLIC_URL}/api/assistant/channels/telegram" \
     -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
     -d 'allowed_updates=["message"]' \
     -d "drop_pending_updates=true"
   ```
   Telegram then sends the secret in `X-Telegram-Bot-Api-Secret-Token` on every
   call. A call without it, or with a different one, gets a 401.
5. Check it:
   ```sh
   curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
   ```
   `pending_update_count` should stay at 0 and there should be no `last_error_message`.

If you change `TELEGRAM_WEBHOOK_SECRET`, run `setWebhook` again with the new
secret.

## WhatsApp (Cloud API)

1. In **Meta for Developers**, create an app of type Business and add the
   **WhatsApp** product. Under **WhatsApp → API Setup**, pick the sending
   number. You can start with Meta's test number; it can only message the
   recipient numbers you add there.
   - `WHATSAPP_PHONE_NUMBER_ID` = the **Phone number ID** shown there (not the number itself)
   - `WHATSAPP_DISPLAY_NUMBER` = the number as people should type it, for example `+92 300 1234567`
2. Make a **permanent token**. The token on the API Setup page expires within a
   day. In **Business settings → Users → System users**, add a system user
   (Admin) and assign it the app and the WhatsApp account with full control.
   Then **Generate new token** for the app with `whatsapp_business_messaging`
   and `whatsapp_business_management`, and set it to never expire.
   - `WHATSAPP_TOKEN` = that token
3. In **App settings → Basic**, show the **App secret**. Meta signs every
   webhook call with it (`X-Hub-Signature-256`). A call that does not verify gets a 401.
   - `WHATSAPP_APP_SECRET` = the app secret
4. Make up a verify token (for example `openssl rand -hex 24`). Meta sends it
   once when you register the webhook.
   - `WHATSAPP_VERIFY_TOKEN` = that value
5. Restart the app with the variables set. Then go to **WhatsApp →
   Configuration → Webhook → Edit**:
   - Callback URL: `${APP_PUBLIC_URL}/api/assistant/channels/whatsapp`
   - Verify token: the `WHATSAPP_VERIFY_TOKEN` value
   - **Verify and save**, then subscribe to the **`messages`** webhook field.
6. Before real use, add your real business number and publish the app (Live
   mode). Meta limits what a Development-mode app receives.

SED AI only ever *replies*, within 24 hours of the person's own message. Plain
text messages are always allowed in that window, so no message templates are needed.

## Variables

| Variable | What it is |
| --- | --- |
| `APP_PUBLIC_URL` | Public https address of the app. Used for links in replies. |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather. |
| `TELEGRAM_BOT_USERNAME` | The bot's username, without `@`. Shown in the link instructions. |
| `TELEGRAM_WEBHOOK_SECRET` | Secret passed to `setWebhook` as `secret_token`. |
| `WHATSAPP_TOKEN` | Permanent system-user access token. |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID of the sending number. |
| `WHATSAPP_APP_SECRET` | The Meta app's App secret. Verifies webhook signatures. |
| `WHATSAPP_VERIFY_TOKEN` | Your own value for Meta's webhook check. |
| `WHATSAPP_DISPLAY_NUMBER` | The number people send messages to, as shown in the instructions. |

All of these are server-side. Never prefix them with `NEXT_PUBLIC_`. The app
never logs, echoes or returns them, apart from the bot username and the
display number.

## How people use it

- **Link:** SED AI → Actions → Reminders & automations → Phone → **Link
  Telegram** or **Link WhatsApp**. They then send the message shown, for
  example `link 123456`, to the bot or number. On Telegram, **Open Telegram** →
  **Start** sends it for them. Each code works once, for 10 minutes. The page
  switches to "Linked" by itself, and a bell notification confirms the link.
- **Ask:** anything, as in the app. The answers come back as plain text:
  links become full URLs, and charts and tables are pointed to the app.
- **Act** (people with Act mode): a proposed change arrives as text with its
  values, its warnings and what to reply:
  - `YES` / `NO`. When one answer proposes several changes, they are numbered: `YES 2`, `NO 1`.
  - A **high-impact** change needs its confirmation words typed out, as in the app.
  - Something they **can't do themselves**: `YES` sends it to an admin for approval.
  - `YES` only refers to the proposals in the answer to their latest message.
    After any other message, `yes` is just an answer to the assistant.
- One answer at a time per chat ("Still working on your last message…"). An
  answer is stopped after 5 minutes.
- **Unlink:** the Unlink button on the same page. The chat is told it was
  unlinked. A deactivated account's chats are unlinked automatically the next
  time they write.

## Safety

- Linking needs both sides: the code proves who the person is (they were
  signed in to create it), and sending it proves the chat is theirs.
- Codes are six random digits, used once, and valid for 10 minutes. Creating a
  new code cancels the previous one. Wrong codes are limited: 5 per chat and
  100 overall in any 15 minutes.
- Telegram groups are ignored, so a group cannot act as whoever linked it.
- An unlinked chat only ever gets "This chat is not linked…" back. It never gets any data.
- Each message from a linked chat runs as that person (a short-lived session
  of theirs; see `lib/auth/actAs.ts`). Permissions, row-level security and
  per-action switches apply as in the app.
- Replies are plain text: no Markdown or HTML parse mode.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `getWebhookInfo`: `Wrong response from the webhook: 307` | The webhook paths are not public in `lib/supabase/middleware.ts`. |
| `… : 401 Unauthorized` | `TELEGRAM_WEBHOOK_SECRET` differs from the `secret_token` given to `setWebhook`. |
| `… : 503 Service Unavailable` | The server is missing the channel's variables. Check them and restart. |
| Meta "Verify and save" fails | The verify token does not match `WHATSAPP_VERIFY_TOKEN`, the URL is not public, or the app was not restarted. |
| WhatsApp messages never arrive | Not subscribed to the `messages` field; the app secret is wrong (each call gets a 401); or the number is not the one in `WHATSAPP_PHONE_NUMBER_ID`. |
| Replies never arrive | A wrong or expired token. Look for `[assistant/channels] reply on … failed` in the server log. |
| "Link Telegram" / "Link WhatsApp" is greyed out | That channel's variables are not all set on the server. |
