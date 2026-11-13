# Website review: a published site waits for the developer

**Why:** sales were sending clients links to sites the developer was still fixing.

## What happens now

1. **Publish** (Site Builder, Site Studio, or the template engine) puts the site
   on its subdomain as before, but the link is **not** written to the lead.
   It is saved in `lead_site_reviews` (migration 0101), which only developers
   can read (`tickets.resolve` or `studio.manage`: the Tech and Admin
   departments by default).
2. **Developers are notified** ("Website ready for your review", event
   `website_in_review`, sent to the Tech and Admin departments). On the lead
   page they see a **Website waiting for your review** box with the link.
3. The developer checks the site and fixes it. Re-publishing, the AI developer
   and file uploads all work on the site in review, on the same subdomain.
4. **Finalize website**: the link becomes the lead's website link for
   everyone, and the agent and closer get "Website live". The review row is deleted.

Sales see "The website is being finalized by the developer" and no link until then.

## Edge cases

| Case | What happens |
| --- | --- |
| Redesign of a finished site | The finished link stays on the lead. Sales see "The developer is finishing an update". The new files are on the same subdomain, so they are already visible at that address. |
| Shuffle / new version upload of a site in review | The review follows the new address; nothing reaches sales. |
| Takedown / delete of the site in review | The review is cleared. |
| Go-live on the client's own domain, Hostinger transfer, manual "link to lead", connected domain | Treated as final: written to the lead directly, and any review is cleared. |
| Migration 0101 not applied | Publishing falls back to the old behaviour (the link goes straight to the lead). |

## Code

- `lib/leads/siteReview.ts`: `putSiteInReview`, `finalizeSiteReview`, `currentSiteLink`, `repointSiteReview`, `clearSiteReview`.
- `app/api/leads/[id]/site-review/finalize/route.ts`: the Finalize button.
- `components/leads/SiteReviewBox.tsx`: the box on the lead page.
- Tests: `tests/siteReview.test.ts`, `tests/siteReviewBox.test.tsx`, `tests/siteStudioDeployRun.test.ts`.
