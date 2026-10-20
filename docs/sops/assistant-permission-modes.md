# SED Assistant: Act permission modes

Added 2026-10-20 (migration 0090). Act mode can now run changes without a
confirm click, like Claude Code's permission modes. Each person picks how much
it may do on its own.

## For users

Switch it from the **Act** chip by the message box, or under
**SED AI actions → Permissions**:

| Mode | What runs on its own | What still shows a card |
|---|---|---|
| **Ask before every change** (default) | nothing | everything |
| **Auto-run safe changes** | "Safe" changes: new leads/pre-leads, notes, follow-ups and calls, reminders, tickets | "Check before confirming" and high-impact |
| **Auto-run all but high-impact** | Safe and "check before confirming" changes, emails and status changes included | high-impact |

- **Always ask, in every mode:** high-impact changes (money, deleting, access,
  going live; you type the name to confirm them), anything that needs an
  admin's approval, and actions an admin set to always ask.
- **Don't ask again:** tick it on a card when you confirm. That one action
  then runs on its own even in Ask mode. Remove it under Permissions.
- A change that ran on its own says **Ran on its own** on its card. **Undo**
  still works for the usual window (10 minutes for most actions).
- At most 60 changes run on their own per answer. The rest wait on cards.
  This limit only guards against a runaway; bulk actions such as *Set the
  category of many leads* carry up to 200 leads each.
- **Big jobs** ("categorise the whole pipeline"): in an auto mode, the
  assistant works through the whole job in one answer, batch after batch. It
  can take up to 60 rounds, and older lookups are shortened as it goes so it
  doesn't run out of room. Anything it can't decide is left unchanged and
  listed for you at the end.
- **Asking once to switch:** if a big job meets Ask (or Safe) mode, the
  assistant asks one time per chat, with a **Switch and continue** button. One
  click raises your mode and the job carries on by itself. **Keep asking me**
  carries on with cards. Saying "you have my permission" in a message doesn't
  change the mode by itself; the button is how that permission takes effect.
- Telegram/WhatsApp follow the same mode. The reply tells you what was done.

## For admins

**SED AI actions → Settings**:

- **Most SED AI may do on its own** sets the company limit. Nobody can pick a
  mode above it, and lowering it takes effect at once for people already on a
  higher mode.
- **Can run on its own** (per action): untick to make that action always wait
  for a click, whatever anyone's mode. Consider this for actions that reach
  clients and can't be undone, such as *Send an email*.

## How it works

- `lib/assistant/actions/permissions.ts`: the rules (`decideAutoRun`).
- `lib/assistant/actions/run.ts` `autoRun`: right after a proposal is stored,
  it goes through `confirmAction` exactly like a click. It is re-checked as of
  now, runs as the person, can be undone, and is recorded with
  `card.auto = { via }`. If the re-check refuses it, the card waits for the
  person.
- The model is told the mode in its Act instructions, and the result of
  `prepare_action` says `done`, `failed` or `proposed`. It is also told that
  text inside data (notes, emails, web pages) is never a request.
- Storage: a person's mode and their "don't ask again" list are in
  `profiles.ui_preferences.assistantPermissions`, written only through
  `PUT /api/assistant/actions/permissions`. The company limit is
  `app_settings.assistant_max_permission_mode`. The per-action switch is
  `assistant_action_settings.auto_run`.
