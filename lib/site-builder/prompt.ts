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
  /** The client's own word for their trade, taken verbatim — see
   *  `lib/site-builder/imageNeeds.ts` for the one place this drives anything
   *  (image search queries). Never a guessed/mapped taxonomy. */
  site_type?: string;
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

Return only the page's HTML, starting with its doctype or opening tag and ending with its closing tag. No explanation, no commentary, no markdown fence.`;

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

/** Rewrite an existing template page for this business. */
export function buildPagePrompt(args: {
  brief: BusinessBrief;
  images: SuppliedImage[];
  pageFile: string;
  pageHtml: string;
  /** The other page filenames in this site, so links stay valid. */
  siteFiles: string[];
}): string {
  return `THE BUSINESS
${briefText(args.brief)}

IMAGES CHOSEN FOR THIS SITE
${imagesText(args.images)}

PAGES IN THIS SITE (link only to these)
${args.siteFiles.join(", ")}

THE PAGE TO REWRITE: ${args.pageFile}

${args.pageHtml}`;
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
}): string {
  const refs = args.references
    .map((r) => `DESIGN REFERENCE — ${r.file}:\n\n${r.html}`)
    .join("\n\n----------------------------------------\n\n");

  return `THE BUSINESS
${briefText(args.brief)}

IMAGES CHOSEN FOR THIS SITE
${imagesText(args.images)}

PAGES IN THIS SITE (link only to these)
${args.siteFiles.join(", ")}

YOUR JOB: CREATE A NEW PAGE — "${args.pageName}", to be saved as ${args.newFile}

This page does not exist in the template, so you are designing it. Decide what a "${args.pageName}" page should contain for this particular business, then build it in the template's visual language using the reference pages below. Reuse their header, footer and navigation exactly. Reuse their CSS classes and stylesheet wherever they fit. Do not copy their sections or their content — take the design vocabulary, not the page.

${refs}`;
}
