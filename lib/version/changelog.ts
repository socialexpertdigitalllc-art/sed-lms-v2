/**
 * Single source of truth for the app version and its release history.
 *
 * Scheme: v2.MINOR.PATCH
 *   - MINOR: a big change (a new feature or system). Resets PATCH to 0.
 *   - PATCH: a bug fix, a minor UI change, or a small addition.
 *
 * Add a new release to the TOP of CHANGELOG — APP_VERSION is derived from it.
 * Entries are user-facing release notes, not commit messages.
 */

export type ChangeKind = "feature" | "improvement" | "fix";

export interface ChangelogChange {
  kind: ChangeKind;
  text: string;
}

export interface ChangelogEntry {
  /** Semantic version without the leading "v", e.g. "2.6.1". */
  version: string;
  /** Release date, ISO calendar date, e.g. "2026-07-19". */
  date: string;
  /** Short release name. */
  title: string;
  changes: ChangelogChange[];
}

/** Release history, NEWEST FIRST. */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2.21.0",
    date: "2026-10-02",
    title: "Domains: buy one and the site goes live on it",
    changes: [
      {
        kind: "feature",
        text: "Buy a client's domain from the lead page — Cloudflare by default (at-cost, about $10.46 a year for a .com), or Hostinger when the client needs access to the domain. You see the exact first-year and renewal price before you confirm; the price is re-checked right before buying, a name can never be bought twice, and auto-renew is switched on. Only admins, or users given the new Buy Domains permission, can buy.",
      },
      {
        kind: "feature",
        text: "Once a domain is linked to a lead the dashboard does the rest by itself: DNS records, the Hostinger hosting, the SSL certificate, and putting the lead's site live on the domain. The lead page shows each step as it happens; if the lead's site isn't deployed yet, the domain waits and goes live automatically when it is. If a step can't finish, admins get an alert and a Retry button.",
      },
      {
        kind: "feature",
        text: "New Domains page: every domain on the Cloudflare account, with its lead, status, expiry and auto-renew. Import brings them in — domains already set up by hand are only recorded and linked, never touched. Domains with auto-renew off are flagged, with a one-click switch.",
      },
      {
        kind: "fix",
        text: "The transfer list and the Live Websites tab now show all hosted sites — they stopped at the first 100 of 183.",
      },
    ],
  },
  {
    version: "2.20.1",
    date: "2026-10-01",
    title: "Moving sites to their real domain works again",
    changes: [
      {
        kind: "fix",
        text: "Transfer to custom domain works again. Since the hosting-plan change in mid-August every transfer to a newer domain crashed with a bare \"Transfer failed\" — the new plan left an unnamed free-domain placeholder in the Hostinger domain list, and the transfer tripped over it. A brand-new domain is also given time to finish its hosting setup (a few minutes) instead of failing after 20 seconds, the staging subdomain is only deleted once Hostinger confirms the files are in place, and an SSL certificate is requested for the new domain.",
      },
      {
        kind: "fix",
        text: "Live Websites can be managed again from the deployments board: Download, File history and the AI developer read the live files of sites on the client hosting account (they were unreadable since the plan change), and uploading new files to a live site now saves the current files to its history first, so every overwrite can be undone.",
      },
      {
        kind: "improvement",
        text: "The transfer list now shows every domain you can use — registered on Hostinger or already hosted there — and says what will happen: hosting created, current site replaced (with a snapshot), or blocked. WordPress and other non-static sites are marked on the board and protected from uploads and transfers that would erase them. The Live Websites tab lists what the hosting actually serves.",
      },
      {
        kind: "fix",
        text: "Uploading a site zip larger than 10MB from any upload button no longer fails with \"Expected a multipart form upload\".",
      },
    ],
  },
  {
    version: "2.20.0",
    date: "2026-09-22",
    title: "Dark mode",
    changes: [
      {
        kind: "feature",
        text: "The whole dashboard now has a dark theme, switched from the sun/moon button in the header — every screen, table, chart, panel and dialog, not just the shell. The choice sticks on that device and is applied before the page paints, so there is no white flash on a reload, and it holds on the login screen too. Until you pick a side it simply follows whatever your computer is set to, switching itself when your system does at sunset.",
      },
      {
        kind: "improvement",
        text: "Delete, take-down and other destructive buttons keep a strong red with readable white text in both themes, and chart grids, axes and tooltips follow the theme instead of staying white.",
      },
      {
        kind: "fix",
        text: "The Leads count in the sidebar no longer hides under the + (new lead) button — the counter now sits to the left of it.",
      },
    ],
  },
  {
    version: "2.19.1",
    date: "2026-09-14",
    title: "Popups above everything, filters that keep their options",
    changes: [
      {
        kind: "fix",
        text: "Dialogs and pickers now open on top of the page, everywhere. A finished entrance animation was quietly trapping every popup inside its own section — upload confirmations opened inside the lead details instead of over the screen, and the Area/Category pickers were cut off by the header. The pickers also ride above any container now, like the calendar always did.",
      },
      {
        kind: "fix",
        text: "Filter lists on the leads table no longer lose entries: an agent, platform or region stays listed (so it can still be unselected) even when a month or team scope leaves it with no matching leads — previously a selected agent could vanish from the very list that selected them.",
      },
    ],
  },
  {
    version: "2.19.0",
    date: "2026-09-11",
    title: "Area & category chips, and a faster way in",
    changes: [
      {
        kind: "feature",
        text: "The customer's real area, when their phone says otherwise. A dedicated Area chip — in the Client Identity header on the new-lead form and in the lead's own title band — sets the actual state for a customer who kept a number from somewhere else. The Region filter and its counts follow the override; leave it unset and the area keeps deriving from the phone as before.",
      },
      {
        kind: "feature",
        text: "Lead categories, built by the people submitting leads. A Category chip beside the Area chip picks from a shared list — and when the right category isn't there yet, typing it adds it to the list for everyone, right from the picker. The list starts empty and grows with use.",
      },
      {
        kind: "improvement",
        text: "New lead in one click: a + on the sidebar's Leads item opens the submission form directly, without going through the leads table first.",
      },
    ],
  },
  {
    version: "2.18.0",
    date: "2026-09-11",
    title: "Forms wired in at generation, and a live inbox",
    changes: [
      {
        kind: "feature",
        text: "Every website generation now sets its forms up by itself. Starting a build creates (or reuses) the lead's Form Relay endpoint and hands the submit URL and key to the generator, and a deterministic sweep over the finished files guarantees no template key or web3forms address survives — so the contact form works the moment the site deploys, with no per-client setup.",
      },
      {
        kind: "feature",
        text: "The lead's social profiles reach the website. Profiles captured on the lead — including ones added after submission — go into the generation brief: the site's social icons link to the business's real accounts, and icons for networks it doesn't have are removed instead of left pointing at the template's.",
      },
      {
        kind: "improvement",
        text: "The Forms inbox is live: a submission arriving while the tab is open appears in the table by itself, no refresh — and the sidebar badge moves with it.",
      },
      {
        kind: "feature",
        text: "Filter leads by platform. A Platform filter on the leads table lists whatever platforms the leads actually carry (Google, Yelp, and so on — newly submitted ones appear on their own), with a count for each and a \"No platform\" entry.",
      },
      {
        kind: "improvement",
        text: "The Follow-ups page shows Ready leads only — it is the calling queue, and parked or closed statuses no longer dilute it. The sidebar badge counts the same population.",
      },
      {
        kind: "improvement",
        text: "One style for the lead screen's side-card buttons: Contracts, Website forms, Follow-ups and Tickets now share the same compact create button instead of four different looks.",
      },
    ],
  },
  {
    version: "2.17.0",
    date: "2026-09-11",
    title: "The template sales picked, and a faster calling queue",
    changes: [
      {
        kind: "feature",
        text: "Sales pick the template with the client. The new-lead form now ends with a Template Recommendation section — cards with a cover screenshot and a Preview link — and the pick follows the lead: it shows on the lead screen under Services & scope, and the New site screen starts from it instead of asking whoever builds the site to re-decide from the brief. A line above the picker says whether the recommendation was applied, overridden, or the template is gone. Optional, and changeable at any time.",
      },
      {
        kind: "feature",
        text: "The template board is a catalogue, not a list. Every template is a card led by its cover, with page and asset counts, Preview in a new tab (the whole template, navigable, not one flat page) and an In service switch. In service is the only thing sales see — an off template is simply absent from the lead form — and a template cannot go in service without a cover, because sales pick by picture.",
      },
      {
        kind: "feature",
        text: "Edit a template instead of re-uploading it: rename it, add or replace its cover, or ship updated files, each independently. Sites already built keep what they were built with; the next run uses the new files.",
      },
      {
        kind: "improvement",
        text: "Website addresses are now the business name and nothing else — \"A M Handyman\" deploys to a-m-handyman.dmviral.com. The old random tail was on the very link we send the client, where it read as phishing and made them hesitate to open the site we just built them. A number is added only when another lead genuinely holds the name.",
      },
      {
        kind: "feature",
        text: "Colour matching that answers instantly: enter the client's first colour and a recommended partner appears with a one-line reason for it. Agents were entering colours that did not go together, because choosing a second colour is a design judgement nobody asked them to have. A scheme now takes 2-3 colours — one alone leaves every button and accent to the generator's guess — and the lead screen draws each one as a dot beside its code.",
      },
      {
        kind: "feature",
        text: "The Follow-ups page works as the calling queue it is: the number being dialled sits on the row (tap to dial, one click to copy) instead of a trip into the lead, and a tick and a cross beside the pill log the call on the spot — the tick opens the follow-up already set to Pickup, the cross posts No Pickup and books the retry 24 hours out with nothing to type.",
      },
      {
        kind: "improvement",
        text: "\"Specific time\" now expires. A client who asked for 3:15pm stops being a specific appointment once a day passes with nobody logging a follow-up, so the Specific filter no longer fills up with slots that were never kept. Logging a newer follow-up restarts the clock.",
      },
      {
        kind: "improvement",
        text: "Hover a follow-up pill — on the leads table or the queue — and it shows the comment behind it. A No Pickup pill reaches back to the last pickup and shows that note with its date, so a stale one is obvious at a glance.",
      },
      {
        kind: "feature",
        text: "Three more things the lead form captures: the owner's name, the business's social profiles (as many as it has), and instructions for the developer. All three show on the lead screen.",
      },
      {
        kind: "feature",
        text: "Two new filters on the leads table: Follow-up (Pickup / No Pickup, with a count of each) and a Custom range for the created date, for every ask the month presets do not cover. Both survive a refresh, land in saved views, and clear with Clear filters.",
      },
      {
        kind: "feature",
        text: "Move a site to a fresh address from wherever you are looking at it — the lead screen, the ticket screen and the leads table, beside the download and upload icons (which the leads table gained too). The confirmation names the address before anything moves, because the old one is deleted.",
      },
      {
        kind: "improvement",
        text: "One calendar and one time control throughout the dashboard. Every browser's native date and time box looked and behaved differently; new lead, both follow-up modals, the ticket due date, the work-start setting and the agent report range now share the same picker.",
      },
      {
        kind: "improvement",
        text: "The lead screen opens on what you came to do. Contracts, Website forms, Recent follow-ups and Tickets now load closed, each showing its count, a one-line last-activity summary and its own create button — so raising a ticket or logging a follow-up no longer means scrolling past the history. Open a section to read that history.",
      },
      {
        kind: "feature",
        text: "Tell the generator what this build needs: an Additional instructions box on the New site screen (a bilingual site, a tone to hold, something to lead with) that reaches every page it writes.",
      },
      {
        kind: "improvement",
        text: "Three faults the generated sites kept coming back with are now forbidden as it builds: a control that does nothing (a language, search or dark-mode toggle with nothing behind it), a palette applied so that text disappears into its background, and a page that breaks on a phone. Header logos are sized properly rather than favicon-small, and a detail the brief does not have — an email above all — is removed instead of invented or left over from the template.",
      },
      {
        kind: "fix",
        text: "Custom-domain deploys work again. Splitting the LMS and the client sites onto separate hosting accounts quietly broke every custom-domain transfer and every override upload, which had been writing straight to a disk the LMS could no longer reach; they now go over the hosting's own API.",
      },
      {
        kind: "fix",
        text: "Form Relay follow-ups: the CC address on an endpoint was accepted and then dropped — it is now stored and copied in; a submission can no longer be emailed twice by the retry sweep, nor sit forever as \"sending\" if the send dies mid-flight; and test sends no longer carry the wording and reply-to address that made them look like spam.",
      },
    ],
  },
  {
    version: "2.16.0",
    date: "2026-09-08",
    title: "Form Relay — our own form submission service",
    changes: [
      {
        kind: "feature",
        text: "Client websites now post their contact and booking forms to the LMS instead of web3forms. No more accounts or verification codes per client — create an endpoint, paste the key, done.",
      },
      {
        kind: "feature",
        text: "Every submission is stored and shown in the new Forms section and on the lead's page, emailed to the client from a linked company mailbox, and pinged to the lead's agent.",
      },
      {
        kind: "improvement",
        text: "Spam protection built in: honeypot field, per-IP and per-day limits, and an optional allowed-domains list per endpoint. Failed emails retry automatically and can be resent by hand.",
      },
    ],
  },
  {
    version: "2.15.0",
    date: "2026-09-02",
    title: "The AI developer, refined",
    changes: [
      {
        kind: "feature",
        text: "Choose what the AI works on: send the whole ticket or tick just the changes you want done this run; the rest stay for later.",
      },
      {
        kind: "feature",
        text: "Pick the AI's model per run from Antigravity's own live model list (fetched from the worker, never hardcoded); default stays \"Antigravity default\".",
      },
      {
        kind: "feature",
        text: "Edit the task before sending: the exact request the AI receives is shown and editable in the new pre-send dialog.",
      },
      {
        kind: "feature",
        text: "Direct site edits without a ticket: an \"AI edit site\" button on the lead screen runs the same edit → review → deploy flow for one-off changes.",
      },
      {
        kind: "improvement",
        text: "Tickets keep themselves up to date: sending to the AI moves an assigned ticket to In Progress, a deployed run marks its change items done, and a ticket whose items are all done (by the AI or by hand) resolves itself.",
      },
      {
        kind: "improvement",
        text: "The live progress feed now shows what the AI is actually saying and doing (its words and each tool it runs with its target), not just step labels.",
      },
    ],
  },
  {
    version: "2.14.0",
    date: "2026-09-01",
    title: "The AI developer",
    changes: [
      {
        kind: "feature",
        text: "Send to AI on tickets — from an assigned ticket, the developer can hand the change request to an AI developer that edits a copy of the live site; progress streams into the ticket screen as it works. Nothing touches the live site while it runs.",
      },
      {
        kind: "feature",
        text: "Review before it goes live — the AI's work comes back as a change list with per-file before/after comparisons and a safe preview of the edited site inside the dashboard. One click deploys it, and a snapshot of the live site is taken first so it can be rolled back; \"Request changes\" sends the AI back to refine its work.",
      },
      {
        kind: "improvement",
        text: "The ticket screen shows when the AI worker machine is offline, why a run failed (in the AI's own words), and keeps the full history of AI runs on the ticket next to the existing website-update proof.",
      },
    ],
  },
  {
    version: "2.13.1",
    date: "2026-08-31",
    title: "Generate really is the last click",
    changes: [
      {
        kind: "fix",
        text: "Auto deploy no longer gives up while the hosting is still working. Creating a site's address takes the hosting up to a minute — it builds the address and issues the security certificate before it answers — but we stopped waiting after thirty seconds and called it a failure. The site was left waiting for a manual Deploy even though the address had been created, and the address itself was abandoned. We now wait as long as the hosting needs, and check whether the address appeared before reporting any failure.",
      },
      {
        kind: "improvement",
        text: "Auto deploy is now on by default on the New site screen: pick a lead and a template, press Generate, and the site publishes itself. Untick the box for a client whose site you want to look at before it goes live.",
      },
      {
        kind: "improvement",
        text: "When a site is set to publish itself and cannot, the run now says so and why. Previously it simply sat waiting for review, which looked exactly like a run that was never asked to publish at all.",
      },
    ],
  },
  {
    version: "2.13.0",
    date: "2026-08-22",
    title: "Closer teams, and everyone's name",
    changes: [
      {
        kind: "fix",
        text: "Agents' names now appear everywhere you can see their leads. Anyone without admin rights was shown \"Unassigned\" on every lead but their own — the leads were there, the names were not — so a user given permission to view all agents' leads could not tell whose they were.",
      },
      {
        kind: "feature",
        text: "Closer teams: each closer now has their own sales agents, managed on the Closing department screen. A closer can work on their team's leads, and every change is recorded against the closer — never as if the agent had made it — so it is always clear who actually did what.",
      },
      {
        kind: "improvement",
        text: "The hierarchy is enforced by the database itself: a sales agent belongs to exactly one closer, and a closer can never be placed under another closer. Moving an agent to a different closer just moves them.",
      },
      {
        kind: "fix",
        text: "Dropping a lead from the follow-up window works end to end — the server was still refusing it without a future follow-up time.",
      },
      {
        kind: "feature",
        text: "\"My team\" for closers: a closer's Leads page, Follow-ups page and Dashboard open on their OWN work, and one click adds their sales agents' — rows, status counts, KPIs, charts and exports all follow together. The button only appears for someone who actually has a team.",
      },
      {
        kind: "fix",
        text: "A closer now actually sees their team's leads, follow-ups and tickets. Lead visibility was granted only by the blanket \"view all agents' leads\" permission, so a closer without it saw nothing but their own work no matter who was on their team. Visibility now follows the org chart — and still respects which lead statuses each person is allowed to see.",
      },
    ],
  },
  {
    version: "2.12.0",
    date: "2026-08-18",
    title: "Image picking, rebuilt",
    changes: [
      {
        kind: "feature",
        text: "Pick several images at once: the picker now multi-selects up to the slot's limit and stays open until you press Add, so filling a 3-image Hero from the client's photos is one dialog instead of three.",
      },
      {
        kind: "improvement",
        text: "Images load about 40× lighter. Client photos were being downloaded at full size (roughly 800 KB and several seconds each) just to draw a small tile; they are now resized and cached, so a lead's photos appear almost instantly — and instantly again every time after.",
      },
      {
        kind: "improvement",
        text: "Thumbnails are much bigger and fill the available width instead of sitting as tiny squares in empty space, so you can actually see what you are choosing.",
      },
      {
        kind: "improvement",
        text: "Selecting is instant — the highlight no longer waits on the server — and the picker opens on the client's photos with Library and Pexels searching as you type, with results remembered between openings.",
      },
      {
        kind: "improvement",
        text: "No more pop-up after every picked image. Notifications are reserved for real problems.",
      },
      {
        kind: "improvement",
        text: "The photo extractor now collects up to 30 photos from a Google listing instead of the 3-4 it used to return. Google unloads photos as you scroll past them, so everything scrolled by was being thrown away; the capture now keeps every photo it sees.",
      },
      {
        kind: "feature",
        text: "Auto deploy: tick it on the New Site screen and the website publishes to its subdomain as soon as generation finishes — no approve or deploy click. The lead's website link is filled in and its agent is notified, exactly as with a manual deploy. Off by default, and never applied to bulk generations.",
      },
      {
        kind: "feature",
        text: "Follow-ups can be marked \"Specific time\" when the client asked for an exact slot. They carry a Specific badge on the Follow-ups page and can be filtered down to just those.",
      },
      {
        kind: "improvement",
        text: "Dropping a lead from the follow-up window no longer demands a future follow-up time.",
      },
      {
        kind: "fix",
        text: "A lead saved with \"no email\" is no longer stuck without one — the email field stays editable, and filling it in clears the no-email flag.",
      },
      {
        kind: "improvement",
        text: "Agent, Closed by and Rating are now editable by admins only, on the lead screen and in bulk actions alike.",
      },
    ],
  },
  {
    version: "2.11.1",
    date: "2026-08-17",
    title: "Database load diet",
    changes: [
      {
        kind: "improvement",
        text: "Background jobs and sidebar badges now use a fraction of the database: the site-builder poller stopped re-reading every run's full generated pages each cycle, badge counts are cached for 30 seconds and no longer poll from hidden browser tabs, settings and notification rules are cached in memory, and old-notification cleanup runs a few times a day instead of every minute. Fixes the Supabase disk-IO budget warning.",
      },
    ],
  },
  {
    version: "2.11.0",
    date: "2026-08-14",
    title: "Website update safety",
    changes: [
      {
        kind: "feature",
        text: "One-click rollback: a snapshot of the site's current files is saved automatically before every upload. Each live site on the deployments board has a File history where any of the last 5 versions can be restored — and restoring snapshots the current files first, so it can be undone too.",
      },
      {
        kind: "feature",
        text: "Upload proof on tickets: website files uploaded from a ticket are recorded on that ticket — who uploaded, which zip, how many files, when — so the resolution carries evidence of the fix going live.",
      },
      {
        kind: "feature",
        text: "Forgotten-upload check: resolving a ticket whose lead has a website, with no files uploaded during the ticket, asks \"resolve anyway?\" first — a nudge, never a block.",
      },
    ],
  },
  {
    version: "2.10.2",
    date: "2026-08-13",
    title: "Upload website fixes from the ticket",
    changes: [
      {
        kind: "feature",
        text: "Tech users can now upload updated website files right from the ticket page (and the lead screen): an upload icon next to the download icon replaces the live site's files in place. The button is tied to that lead's website and asks for confirmation naming the site, so fixes can't land on the wrong lead's website.",
      },
      {
        kind: "improvement",
        text: "Uploaded site zips are checked before going live: archives without an index.html are refused, and folder-zipped sites are unpacked correctly instead of landing one folder deep.",
      },
    ],
  },
  {
    version: "2.10.1",
    date: "2026-08-13",
    title: "Download live website files",
    changes: [
      {
        kind: "feature",
        text: "Download any website's current files as a zip, straight from the hosting: a download icon on every live deployments-board row, next to the website link on tickets (tech team), and on the lead screen's website link. Always the files that are live right now — manual edits included — never a stale generator copy.",
      },
    ],
  },
  {
    version: "2.10.0",
    date: "2026-08-02",
    title: "One deployments board",
    changes: [
      {
        kind: "feature",
        text: "All deployments now live in a single board under Site Builder, showing every site on the hosting — generated, hand-uploaded and custom-domain — categorised into Ready, Manual, Others and Live Websites. The old Deployed Sites page redirects here.",
      },
      {
        kind: "feature",
        text: "Shuffle a live site to a fresh subdomain in one click: the current files move to the next version of its address, the old subdomain is removed, the lead's website link is updated and the agent is notified.",
      },
      {
        kind: "feature",
        text: "Uploading over an existing subdomain now asks whether to override it in place or publish a new version subdomain; either way the site stays tracked on the board. New uploads can be linked to a lead right after publishing (optional).",
      },
      {
        kind: "feature",
        text: "Any subdomain — including ones uploaded outside the dashboard — can be linked to a lead, moved to a custom .com domain, or overridden with a zip upload. Going live on a custom domain updates the lead's website link and notifies the agent and management.",
      },
      {
        kind: "feature",
        text: "Bulk-select subdomains and delete them together — selection spans the whole filtered view, so clearing out hundreds of stale sites is one click.",
      },
      {
        kind: "feature",
        text: "New subdomain naming: the first two words of the business name (up to 20 characters) plus a version, e.g. joes-plumbingv1.dmviral.com.",
      },
      {
        kind: "feature",
        text: "Sidebar items with multiple screens now expand into a submenu — jump straight to Site Builder's Templates, New Site, Runs or Deployments.",
      },
      {
        kind: "feature",
        text: "The Follow-ups page opens on Ready leads by default and gained the full filter set: search, status, agent, type, region and due-date buckets. Leads overdue by 30+ days show their age and offer one-click Long Term or Drop.",
      },
      {
        kind: "feature",
        text: "Follow-up scheduling now takes days and hours as well as minutes for the quick time pick.",
      },
      {
        kind: "feature",
        text: "Tickets can now be opened for Closed leads, and the Tickets page works like the Leads page: status tabs with counts, filters, and a paginated table. Ticket pages show the lead's website with an open-in-new-tab link.",
      },
      {
        kind: "feature",
        text: "Choose which lead statuses trigger your follow-up reminders — for example, Ready only — from the Notifications page.",
      },
      {
        kind: "improvement",
        text: "The notification bells now show every unread notification, collapse bursts of the same kind into one row, and website notifications open the live site in a new tab (marking themselves read).",
      },
      {
        kind: "improvement",
        text: "Filter dropdowns across the dashboard are now multi-select — combine several agents, types, statuses or regions at once.",
      },
      {
        kind: "improvement",
        text: "Sidebar counters refresh reliably for everyone, and the Follow-ups badge now counts the same leads the page shows.",
      },
      {
        kind: "improvement",
        text: "The deployments board paints instantly and pages its rows; the hosting inventory is cached so tab switches are immediate.",
      },
      {
        kind: "improvement",
        text: "New tickets without a title take their first checklist item as the title, so lists stay scannable. Notifications unread for over 30 days clear themselves.",
      },
    ],
  },
  {
    version: "2.9.0",
    date: "2026-07-28",
    title: "Photos from Google profiles",
    changes: [
      {
        kind: "feature",
        text: "Save a lead with a Google Business Profile link and its photos are collected for you automatically — up to 30, at full resolution.",
      },
      {
        kind: "feature",
        text: "The Images section of a lead now shows the collected photos as thumbnails. Tick the ones worth keeping and they are hosted for you, with their links added to the lead.",
      },
      {
        kind: "feature",
        text: "A new Image Hosts page under Admin, where you can add as many imgbb and imgchest keys as you like. Uploads work down the list, so a key that hits its limit steps aside for the next one instead of stopping the job.",
      },
      {
        kind: "feature",
        text: "A one-click download for the browser extension that does the collecting, with setup steps and a prompt when a newer version is available.",
      },
      {
        kind: "improvement",
        text: "Photos are collected again automatically if you correct a lead's profile link, so a typo fixed later still gets its photos.",
      },
      {
        kind: "improvement",
        text: "Typing image links by hand still works exactly as before — the picker sits above that field rather than replacing it.",
      },
      {
        kind: "fix",
        text: "The extension no longer mixes in a few photos from the business you looked at previously when you collect from a second one without reloading.",
      },
      {
        kind: "fix",
        text: "The extension's selected-photo count no longer counts leftovers from an earlier business.",
      },
    ],
  },
  {
    version: "2.8.0",
    date: "2026-07-19",
    title: "Notifications & changelog",
    changes: [
      {
        kind: "feature",
        text: "An unread-mail badge in the sidebar and on the browser tab, so you can see new mail without opening the mailbox.",
      },
      {
        kind: "feature",
        text: "Notifications for incoming mail and for contract activity, delivered through the existing notification settings.",
      },
      {
        kind: "feature",
        text: "A version chip in the corner of the app that links to this public changelog.",
      },
      {
        kind: "improvement",
        text: "New mail is checked on a schedule in the background, so badges stay current while you work.",
      },
    ],
  },
  {
    version: "2.7.0",
    date: "2026-07-19",
    title: "In-dashboard mailbox",
    changes: [
      {
        kind: "feature",
        text: "Read your linked company inbox without leaving the dashboard, in a two-pane list and reading view.",
      },
      {
        kind: "feature",
        text: "Compose new messages and reply to threads directly from the mailbox.",
      },
      {
        kind: "feature",
        text: "Attach files to any message you send, with sent mail saved back to your Sent folder.",
      },
    ],
  },
  {
    version: "2.6.1",
    date: "2026-07-19",
    title: "Templates & sign-in fixes",
    changes: [
      {
        kind: "fix",
        text: "Connecting Google now returns you to the correct domain after consent instead of dropping you on the wrong address.",
      },
      {
        kind: "fix",
        text: "The contract templates page now explains exactly why a Drive folder lists no documents, instead of showing an empty list.",
      },
    ],
  },
  {
    version: "2.6.0",
    date: "2026-07-19",
    title: "Google Docs contract templates",
    changes: [
      {
        kind: "feature",
        text: "Connect your Google account and register contract templates straight from a Drive folder.",
      },
      {
        kind: "feature",
        text: "Every contract is generated by copying the template document, filling its {{placeholders}} from the lead and exporting a PDF.",
      },
      {
        kind: "feature",
        text: "A placeholder catalog showing what each template can use, including custom lead fields and date/time placeholders.",
      },
      {
        kind: "improvement",
        text: "Generated contracts are stored in their own Drive folder, keeping templates clean.",
      },
      {
        kind: "improvement",
        text: "Agents can adjust pricing on a contract to apply a discount before it goes out.",
      },
    ],
  },
  {
    version: "2.5.0",
    date: "2026-07-18",
    title: "Contract management",
    changes: [
      {
        kind: "feature",
        text: "Generate a contract from a lead's details, preview it, and email it from the agent's own mailbox.",
      },
      {
        kind: "feature",
        text: "Per-agent signatures applied to the contracts they send.",
      },
      {
        kind: "feature",
        text: "A contracts list across all leads, plus a “Contract Sent” badge on the leads that already have one.",
      },
    ],
  },
  {
    version: "2.4.0",
    date: "2026-07-18",
    title: "Company mailbox",
    changes: [
      {
        kind: "feature",
        text: "Link company email accounts to users, with credentials stored encrypted.",
      },
      {
        kind: "feature",
        text: "IMAP and SMTP verification at link time, so a broken mailbox is caught before anyone tries to send.",
      },
    ],
  },
  {
    version: "2.3.0",
    date: "2026-07-18",
    title: "Custom-domain transfer",
    changes: [
      {
        kind: "feature",
        text: "Move a finished site from its staging subdomain to the client's own domain, taking the files fresh from the live server and removing the subdomain afterwards.",
      },
      {
        kind: "feature",
        text: "Upload a custom ZIP to a new or existing subdomain for sites built outside the wizard.",
      },
    ],
  },
  {
    version: "2.2.1",
    date: "2026-07-18",
    title: "Accurate deploy status",
    changes: [
      {
        kind: "fix",
        text: "Deploys no longer report a false failure while the new site is still coming online — the reported status now matches reality.",
      },
    ],
  },
  {
    version: "2.2.0",
    date: "2026-07-18",
    title: "Website deployment",
    changes: [
      {
        kind: "feature",
        text: "Deploy a generated site to a staging subdomain in one click.",
      },
      {
        kind: "feature",
        text: "Redeploy in place or take a site down when it is no longer needed.",
      },
      {
        kind: "feature",
        text: "A deployments board listing every deployed site and its current state.",
      },
    ],
  },
  {
    version: "2.1.1",
    date: "2026-07-18",
    title: "Wizard & imagery polish",
    changes: [
      {
        kind: "improvement",
        text: "Image gathering is faster and far more reliable — the build no longer stalls while collecting and ranking photos.",
      },
      {
        kind: "fix",
        text: "The generated site's header now shows the business logo instead of the business name whenever a logo is available.",
      },
    ],
  },
  {
    version: "2.1.0",
    date: "2026-07-17",
    title: "Template Engine",
    changes: [
      {
        kind: "feature",
        text: "Generate a complete client website from a lead's details with a five-step operator wizard: setup, content, images, build and review.",
      },
      {
        kind: "feature",
        text: "A lead dossier that gathers everything known about the business and derives the site's pages automatically.",
      },
      {
        kind: "feature",
        text: "AI image gathering with vision-based ranking, so each page starts from strong, relevant photos.",
      },
      {
        kind: "feature",
        text: "Verification gates that check a build before it can be handed over.",
      },
    ],
  },
  {
    version: "2.0.0",
    date: "2026-07-16",
    title: "Core platform",
    changes: [
      {
        kind: "feature",
        text: "The leads pipeline: capture, categorise, follow up and track every lead through to close.",
      },
      {
        kind: "feature",
        text: "Tickets and payments, tied back to the leads and clients they belong to.",
      },
      {
        kind: "feature",
        text: "Analytics and dashboards for individual agents and for the company as a whole.",
      },
      {
        kind: "feature",
        text: "Departments and granular permissions controlling what each role can see and do.",
      },
      {
        kind: "feature",
        text: "In-app notifications for the events that matter to you.",
      },
    ],
  },
];

/** Current application version, derived from the newest changelog entry. */
export const APP_VERSION: string = CHANGELOG[0].version;

/** "2.6.1" -> "v2.6.1" (idempotent). */
export function formatVersion(v: string): string {
  const bare = v.startsWith("v") ? v.slice(1) : v;
  return `v${bare}`;
}

/** "2.6.1" -> [2, 6, 1]. Throws on anything that is not MAJOR.MINOR.PATCH. */
export function parseVersion(v: string): [number, number, number] {
  const bare = v.startsWith("v") ? v.slice(1) : v;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(bare);
  if (!m) throw new Error(`Invalid version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative if a < b, positive if a > b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
