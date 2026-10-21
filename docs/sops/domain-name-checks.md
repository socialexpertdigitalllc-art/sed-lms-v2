# Domain name checks — runbook

Added 2026-10-21 (migration 0091). Two ways to know whether a customer's name
is free as a domain before the domain conversation.

## On the lead: the exact name, checked when the lead turns Ready

- When a lead becomes **Ready**, the LMS checks the business name as one word
  on .com: *ABC Construction LLC* → `abcconstructionllc.com`. This is the
  same exact-match rule as the Buy dialog.
- The result shows on the lead's **Domain** card, in the collapsed summary
  too: *no domain yet · abcconstruction.com available*. It says
  **Available** (with the first-year and renewal price), **Taken**,
  **Premium** or **Couldn't check**. **Check again** asks now.
- **When it's checked:**
  - when a lead turns Ready by a status change, a follow-up's status change
    or a bulk change (from the app or SED AI);
  - by the 15-minute domains sweep for everything else: imports, leads
    created as Ready, the Ready leads that existed before this, renamed
    leads, failed checks (retried after 30 minutes), and answers over a week
    old.
- Leads that aren't Ready can be checked by hand with **Check now**.

## Domains → Check a name (also *Domain check* in the sidebar)

- For anyone with **domains.view** (sales, closing, tech, management, admin),
  for checking names on a call.
- Type the business name or a domain; no ending means .com. The exact name
  comes first, on its own, as available or taken, with its price. Then the
  same name on other endings, then different names, with what differs
  marked.
- Read only, with a copy button per name. Buying still happens from the
  lead's Domain card (domains.purchase). Recent searches are kept on the
  device.

## Limits and costs

- Checks call the registrar (Cloudflare by default; Hostinger if Cloudflare
  isn't set up). Each person gets **40 checks per 5 minutes**, shared between
  the lead card and the Check-a-name page.
- The sweep checks up to 60 Ready leads per round. Cloudflare answers 20
  names per call, so that is 3 calls every 15 minutes at most.

## How it works

- `lib/domains/leadCheck.ts`:
  - `leadExactDomain` names the domain;
  - `checkLeadDomains` checks and stores;
  - `kickLeadDomainChecks` is called from the status routes via `after()`;
  - `dueLeadChecks` decides what the sweep picks up.
- `lead_domain_checks` holds one row per lead. It is kept off `leads` so a
  check never bumps `updated_at` or the leads realtime feed.
- Routes:
  - `GET/POST /api/leads/[id]/domain-check` (domains.view, and the lead must
    be visible to the person);
  - `GET /api/domains/check`, the same answer as the buying search,
    shared via `lib/domains/searchResponse.ts`.
- `lib/domains/checkRate.ts`: the per-person brake.
