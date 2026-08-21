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
        text: "\"My team\" scope for closers: one click on the Leads page, the Follow-ups page or the Dashboard narrows everything — rows, status counts, KPIs, charts and exports — to the closer and their own sales agents. It only appears for someone who actually has a team.",
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
