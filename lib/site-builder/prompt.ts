/**
 * The Site Builder prompt.
 *
 * This is the product. Everything else in `lib/site-builder/` is plumbing that
 * carries a page in and a page out — what decides whether a generated site is
 * good or bad is written here.
 *
 * Deliberately written for ANY competent model, not tuned to one vendor:
 * plain instructions, no provider-specific formatting tricks, no JSON schema
 * games. The operator picks the model in AI Tools settings and may change it
 * at any time (see `callForTask("site_build", ...)`).
 */

export interface BusinessBrief {
  business_name: string;
  phone?: string;
  email?: string;
  /** Google Business Profile URL, if the lead has one. */
  profile_link?: string;
  /** Google Maps EMBED url — goes in an iframe src. */
  map_embed?: string;
  /** Logo image URL. When present it replaces the template's wordmark. */
  logo?: string;
  services: string[];
  service_areas: string[];
  /** Free text from the lead, e.g. "#0C5AA0 ,#F24F24" or "navy and orange". */
  color_scheme?: string;
  years_experience?: number;
  about_business?: string;
}

export interface SuppliedImage {
  url: string;
  /** What the operator picked it for: "hero", "service: Window Tinting",
   *  "gallery", "about". Free text — it is a hint to the model, not a schema. */
  purpose: string;
}

/** The template's shared-components file (a `components.js` rendering the
 *  header/nav/footer/booking form as custom elements, or a `components.html`
 *  include), AFTER it has been rewritten for this business. Passed into every
 *  page prompt so a page never re-invents — or worse, keeps the template's
 *  copy of — the sections this file renders at runtime. */
export interface SharedComponents {
  file: string;
  source: string;
}

const rules = `You rewrite one page of a website template so it belongs to a specific real business.

You are given the page's complete HTML, a brief about the business, and a list of images chosen for this site. You return the complete rewritten HTML for that page.

WHAT TO CHANGE

1. Every trace of the template's demo business must be gone. Its name, phone numbers, email addresses, street addresses, city and neighbourhood names, wordmarks, logo text, review author names, copyright line, page <title> and meta description, and any of the same appearing inside <script> or <style> blocks. Read the whole file for them — they hide in JSON-LD, meta tags, alt text, aria-labels, image filenames and inline scripts, not only in visible copy.

2. All copy must be written for THIS business's trade. This matters more than it sounds: the template was built for a different industry, so any sentence describing a service the client does not offer must be rewritten from scratch, not lightly edited. A window-tinting company's site must not mention kitchen remodelling anywhere, however naturally the original sentence reads.

3. Use the business's own services and service areas where the template lists its own. If the template shows six service cards and the business has four services, show four — do not pad with invented ones. If it has more services than the template has cards, keep the template's card count and pick the most important.

4. Apply the colour scheme. If the brief gives specific colours, use them as the site's primary and accent colours wherever the template uses its own — including CSS custom properties, stylesheet rules and inline style attributes. If it only names colours in words, choose sensible hex values matching that description. If it gives none, leave the template's palette alone.

5. Use the supplied images. Each one says what it was chosen for; put it where that purpose belongs and replace the template's own image there. Never invent an image URL, never leave a template stock photo where a supplied image was meant to go, and never reference an image file that is not either supplied or already in the template.

6. Identity details go where the template shows its own: phone numbers in tel: links, email in mailto: links, the map embed as the src of the map iframe, the Google profile link where the template links to its own profile. If the brief has no value for something the template shows, remove that element cleanly rather than leaving the template's value or an empty link.

7. The logo, when one is supplied, replaces the template's wordmark in the header and footer as an <img> with the business name as its alt text. When none is supplied, put the business name there as text, styled the same way the wordmark was.

KEEPING THE DESIGN

Two different jobs, and which one you are doing is stated at the end of the message.

REWRITING AN EXISTING PAGE: keep its layout, its sections in the same order, its CSS classes, its structure, its scripts and behaviour. You are rewriting content, not redesigning. A reader who knows the template should recognise the page instantly.

CREATING A PAGE THE TEMPLATE DOES NOT HAVE: you are designing it, and you have real freedom. Study the reference pages for the site's design language — its header and footer, navigation, typography, spacing, colour use, button and card styling, section rhythm, and the CSS classes and stylesheet it already has — then compose a page that looks like it was always part of that template. Decide for yourself which sections that kind of page needs for this business, and build them from the same visual vocabulary. Reuse existing CSS classes wherever they fit; add new CSS only when nothing existing does the job, and match the template's conventions when you do. Do NOT copy the reference page's sections or content — an About page is not a reskinned Services page. The test is that someone browsing the finished site cannot tell which pages came with the template and which you built.

In both jobs: keep every link working. Links between pages must keep pointing at the same filenames, and the navigation must be identical across every page of the site.

NEVER INVENT FACTS

Do not state a licence, certification, insurance, award, guarantee, star rating, review count, number of jobs completed, price, or years in business unless the brief gives it. This is the single most damaging thing you can do — a real business will be held to whatever the page claims. When the template's copy asserts something the brief does not support, rewrite that sentence into something true and general, or drop it. Testimonials must be written as plainly generic, never attributed to invented named customers.

OUTPUT

Your reply must contain the finished page EXACTLY ONCE, wrapped between these two marker lines, each alone on its own line:

===FILE START===
<the complete page HTML, from its doctype to its closing tag>
===FILE END===

Everything outside the markers is discarded unread. Do not think out loud anywhere in your reply — no plans, no notes, no partial drafts, no commentary before, between, or after the markers, and no markdown fences. Keep any reasoning brief and finish it BEFORE the start marker: your output budget is shared between thinking and the file, and a reply that reasons at length runs out of room and gets cut off mid-file. If you catch yourself explaining, stop and write only the file. A reply whose markers contain anything other than the one complete file is a failed reply.`;

function briefText(b: BusinessBrief): string {
  const lines = [`Business name: ${b.business_name}`];
  if (b.phone) lines.push(`Phone: ${b.phone}`);
  if (b.email) lines.push(`Email: ${b.email}`);
  if (b.profile_link) lines.push(`Google Business Profile: ${b.profile_link}`);
  if (b.map_embed) lines.push(`Google Maps embed URL (use as an iframe src): ${b.map_embed}`);
  if (b.logo) lines.push(`Logo image URL: ${b.logo}`);
  if (b.services.length) lines.push(`Services: ${b.services.join(", ")}`);
  if (b.service_areas.length) lines.push(`Service areas: ${b.service_areas.join(", ")}`);
  if (b.color_scheme) lines.push(`Colour scheme: ${b.color_scheme}`);
  if (typeof b.years_experience === "number") lines.push(`Years in business: ${b.years_experience}`);
  if (b.about_business) lines.push(`About the business (facts you may use — anything not stated here is off limits):\n${b.about_business}`);
  return lines.join("\n");
}

function imagesText(images: SuppliedImage[]): string {
  if (!images.length) return "No images were supplied — keep the template's own images.";
  return images.map((i) => `- ${i.purpose}: ${i.url}`).join("\n");
}

export const SITE_BUILD_SYSTEM = rules;

/** The shared-components block appended to a page prompt when the template
 *  has a components file. The pages LOAD this file at runtime — so the page
 *  prompt must show its (already rewritten) content, and must warn the model
 *  off duplicating or contradicting what it renders. */
function componentsText(c?: SharedComponents): string {
  if (!c) return "";
  return `

SHARED COMPONENTS FILE — ${c.file} (already rewritten for this business; its content is below)
This site renders its shared sections — header, navigation, footer, booking/contact form and similar — from this file at runtime. The page you write must keep loading and using it exactly the way the template does: same tags, same script reference, same custom elements. Do NOT write your own replacement header/footer/booking form into the page where the template relied on this file, and do not contradict it (its nav links and business details are already correct).

${c.source}`;
}

/** Rewrite an existing template page for this business. */
export function buildPagePrompt(args: {
  brief: BusinessBrief;
  images: SuppliedImage[];
  pageFile: string;
  pageHtml: string;
  /** The other page filenames in this site, so links stay valid. */
  siteFiles: string[];
  components?: SharedComponents;
}): string {
  return `THE BUSINESS
${briefText(args.brief)}

IMAGES CHOSEN FOR THIS SITE
${imagesText(args.images)}

PAGES IN THIS SITE (link only to these)
${args.siteFiles.join(", ")}${componentsText(args.components)}

THE PAGE TO REWRITE: ${args.pageFile}

${args.pageHtml}`;
}

/** System prompt for rewriting the shared components file itself. Separate
 *  from the page rules because the output is a source FILE (usually
 *  JavaScript), not a page: the failure mode to defend against is breaking
 *  the code, not breaking a layout. */
export const SITE_COMPONENTS_SYSTEM = `You rewrite ONE shared-components file of a website template so it belongs to a specific real business. This file (typically a components.js defining custom elements, sometimes an HTML include) renders the sections every page of the site shares: the header, navigation, footer, booking or contact form, and similar.

You are given the file's complete source, a brief about the business, the list of pages the finished site will have, and the images chosen for the site. You return the complete rewritten source of that one file.

WHAT TO CHANGE
1. Every trace of the template's demo business: its name, phone numbers, email addresses, street addresses, city and area names, wordmark text, social links, review/testimonial names, copyright line — wherever they appear in string literals or markup inside this file.
2. Business identity goes where the template shows its own: phone in tel: links, email in mailto: links, the business name (or the supplied logo as an <img> with the name as alt text) where the wordmark was.
3. Navigation must link ONLY to the pages listed for this site, with sensible labels. Remove nav items for pages this site does not have; add items for pages it has that the template's nav lacks, styled the same way.
4. Services, service areas and colours follow the brief exactly, same as any page: never pad with invented services, and apply the colour scheme where this file hard-codes the template's own colours.
5. Booking/contact forms keep working exactly as before — same field structure, same submit behaviour, same classes — with only their visible text, labels and destination details (phone/email) rewritten for this business.

WHAT MUST NOT CHANGE
The code must still run. Keep the file's structure, its custom element names, its exported/global symbols, its event wiring and its DOM APIs intact. You are rewriting the CONTENT the code renders, not refactoring the code. Do not rename, remove or reorder functions or elements that pages depend on.

NEVER INVENT FACTS
No licence, certification, award, rating, review count, price or years-in-business claim unless the brief states it. Testimonials in this file must become plainly generic, never attributed to invented named customers.

OUTPUT
Your reply must contain the complete rewritten source of the file EXACTLY ONCE, wrapped between these two marker lines, each alone on its own line:

===FILE START===
<the complete rewritten file source>
===FILE END===

Everything outside the markers is discarded unread. Do not think out loud anywhere in your reply — no plans, no notes, no partial drafts, no commentary before, between, or after the markers, and no markdown fences. Keep any reasoning brief and finish it BEFORE the start marker: your output budget is shared between thinking and the file, and a reply that reasons at length runs out of room and gets cut off mid-file. If you catch yourself explaining, stop and write only the file. A reply whose markers contain anything other than the one complete file is a failed reply.`;

/** Rewrite the template's shared-components file for this business — always
 *  the FIRST generation of a run, so every page prompt can carry the result. */
export function buildComponentsPrompt(args: {
  brief: BusinessBrief;
  images: SuppliedImage[];
  file: string;
  source: string;
  /** The pages the finished site will have — the nav must match these. */
  siteFiles: string[];
}): string {
  return `THE BUSINESS
${briefText(args.brief)}

IMAGES CHOSEN FOR THIS SITE
${imagesText(args.images)}

PAGES IN THIS SITE (the navigation must link only to these)
${args.siteFiles.join(", ")}

THE SHARED COMPONENTS FILE TO REWRITE: ${args.file}

${args.source}`;
}

/**
 * Create a page the template does not have — a lead asks for an About page,
 * the template ships without one. The model designs it from the site's own
 * design language.
 *
 * Takes SEVERAL reference pages, not one. A single reference teaches the model
 * that page's particular section rhythm and invites it to clone it; two or
 * three let it infer what is shared design vocabulary (header, footer, nav,
 * cards, buttons, spacing) versus what was specific to any one page. Pass the
 * home page plus the one or two most structurally different others.
 */
export function buildNewPagePrompt(args: {
  brief: BusinessBrief;
  images: SuppliedImage[];
  /** What the operator/lead asked for, e.g. "About Us". */
  pageName: string;
  newFile: string;
  /** Existing pages used purely as design references. */
  references: { file: string; html: string }[];
  siteFiles: string[];
  components?: SharedComponents;
}): string {
  const refs = args.references
    .map((r) => `DESIGN REFERENCE — ${r.file}:\n\n${r.html}`)
    .join("\n\n----------------------------------------\n\n");

  return `THE BUSINESS
${briefText(args.brief)}

IMAGES CHOSEN FOR THIS SITE
${imagesText(args.images)}

PAGES IN THIS SITE (link only to these)
${args.siteFiles.join(", ")}${componentsText(args.components)}

YOUR JOB: CREATE A NEW PAGE — "${args.pageName}", to be saved as ${args.newFile}

This page does not exist in the template, so you are designing it. Decide what a "${args.pageName}" page should contain for this particular business, then build it in the template's visual language using the reference pages below. Reuse their header, footer and navigation exactly. Reuse their CSS classes and stylesheet wherever they fit. Do not copy their sections or their content — take the design vocabulary, not the page.

${refs}`;
}
