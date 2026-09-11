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
  /**
   * Logo image URL. When present it OVERRIDES the template's wordmark: the
   * header and footer show the logo and the wordmark text is hidden — hidden
   * and not deleted, because template scripts look those elements up by id
   * (Northpoint's script.js does `getElementById('np-logo-txt').style` with no
   * guard, and one null there kills its whole controller). Must be a DIRECT
   * image URL: an `https://ibb.co/<id>` share page is an HTML page, not an
   * image, and renders as a broken <img> — the direct form is `i.ibb.co/...`.
   */
  logo?: string;
  services: string[];
  service_areas: string[];
  /** Free text from the lead, e.g. "#0C5AA0 ,#F24F24" or "navy and orange". */
  color_scheme?: string;
  years_experience?: number;
  about_business?: string;
  /** The business's own social profiles — the site's social icons/links point
   *  at these and ONLY these (see the social rule in both system prompts). */
  social_profiles?: { platform: string; url: string }[];
  /**
   * The lead's own Form Relay endpoint (created at run start — see
   * lib/site-builder/formRelay.ts): every form on the site posts here. Also
   * enforced deterministically over the finished files, so this is the
   * instruction half of a two-part guarantee.
   */
  form_relay?: { submit_url: string; access_key: string };
  /**
   * Free-text custom instructions the operator typed when starting THIS run
   * (e.g. "make the site bilingual English/Spanish with a language toggle").
   * Not part of the lead — they live on the run's options.
   */
  instructions?: string;
}

export interface SuppliedImage {
  /**
   * The image's own DIRECT, PUBLIC URL — a Pexels CDN link, a link already
   * stored in the library, or the client's own photo link. This exact string
   * becomes the page's `src`; nothing is downloaded or rehosted (see
   * `lib/site-builder/imageLibrary.ts`).
   */
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

4. Colours. The site's palette lives in the shared components file's SITE THEME block — a few CSS variables (PRIMARY, ACCENT, DARK) that the template's stylesheet derives every brand colour from. When that file is shown to you below, its theme is ALREADY set for this business, so a page never needs to restate the palette: keep using the template's var(--…) references exactly as they are, and they take the new colours automatically. What a page must do is stop carrying the template's OLD colours anywhere they are hard-coded: a hex in an inline style, a gradient, a <style> block, an SVG fill or stroke, a rgba() built from the old brand colour. Replace each with the matching palette variable, or with the brief's colour when no variable fits. Never leave the template's own hex where the brief supplies a colour. If the brief gives no colour scheme, leave every colour as it is.

5. Use the supplied images. Each one says what it was chosen for; put it where that purpose belongs and replace the template's own image there. Never invent an image URL, never leave a template stock photo where a supplied image was meant to go, and never reference an image file that is not either supplied or already in the template.

6. Identity details go where the template shows its own: phone numbers in tel: links, email in mailto: links, the map embed as the src of the map iframe, the Google profile link where the template links to its own profile. Social media icons and links point at the brief's social profiles — each supplied profile gets the matching network's icon/link, and an icon for a network the brief does not list is removed cleanly, never left pointing at the template's own account and never invented. If the brief has no value for something the template shows, remove that element cleanly rather than leaving the template's value or an empty link.

7. THE LOGO OVERRIDES THE WORDMARK. When the brief supplies a logo URL, the header and footer show that logo as an <img> with the business name as its alt text, and the template's wordmark TEXT must not be visible beside it. The logo IS the brand mark — not a badge added next to the name. A brand area is usually a lockup of two things, a mark or coloured shape plus a text span; replacing only the shape and leaving the text there is the common mistake, and it is wrong.

HIDE THAT TEXT, NEVER DELETE IT. Keep the wordmark element exactly where it is, with its tag, its id, its classes and its other attributes untouched, and add display:none to its style attribute alongside whatever style it already had. The template's own scripts and stylesheets look these elements up by id and class; one that has been removed rather than hidden makes them throw at runtime, and a single throw during setup kills every piece of behaviour on the page.

SIZE THE LOGO. A logo file is usually a large image, and an <img> with no size renders at its natural size — a header logo that covers the whole screen. Every logo <img> you place gets the template's own logo-image class when it has one, AND an explicit inline size regardless: style="height:56px;width:auto;max-width:250px;object-fit:contain;display:block" in the header (use the header's existing logo height if the template's CSS defines one) and slightly smaller in the footer. Too small is also wrong — a header logo under ~48px tall looks like a favicon; the brand mark should read at a glance. Never a bare <img src> for a logo.

When no logo is supplied, put the business name there as text, styled the same way the wordmark was, and hide nothing.

FORMS SUBMIT TO THE BRIEF'S ENDPOINT. When the brief gives a form endpoint (a submit URL and an access_key), every contact/booking/quote form on the page posts to THAT URL with THAT access_key — replacing whatever destination the template used (web3forms or anything else), in every shape it appears: a form's action attribute, a hidden access_key input, a fetch call's URL and JSON body, a formData.append. Keep the form's existing submit mechanics and field structure, and keep the hidden "botcheck" honeypot field where the template has one (add it when you build a new form). Never leave the template's own access_key or submit URL anywhere in the page or its scripts. If the brief gives no endpoint, leave the form's destination exactly as the template had it.

EVERY CONTROL MUST WORK. Never add a button, link or toggle that has no working implementation behind it — a language/"Español" switcher, a search box, a dark-mode toggle, a working-hours widget. A dead control is a defect the client sees immediately. Add a language toggle ONLY when the brief explicitly asks for a bilingual site, and then only by actually implementing it in the page: both languages present in the markup (e.g. data-lang sections or paired text attributes) and a small inline script that swaps them — never a link to a page or service that does not exist. When the template ships such a control and the brief does not ask for it, remove it cleanly.

COLOURS MUST STAY READABLE. When you apply the palette, you are changing hues, never the light-versus-dark ROLES of a section: text that sat light on a dark background stays light, text that sat dark on a light background stays dark. The classic failure is a dark brief colour applied to headline text that sits on a dark hero or footer — unreadable dark-on-dark. Before finishing, re-read every section you recoloured and check: headline, body text and buttons must contrast clearly with what is behind them (light text on dark surfaces, dark text on light surfaces); a brand colour too dark to read on a dark background is used on the section's LIGHT elements instead, or lightened. Never place two similar-lightness colours on top of each other.

THE PAGE MUST WORK ON A PHONE. The template is responsive; keep it that way. Keep every media query, responsive class and container wrapper exactly as the template has them. Content you write must live inside the template's existing section/container structure — never a fixed pixel width, never white-space:nowrap on sentences, never a wide table or long unbroken string that forces sideways scrolling. Every image you place gets max-width:100% (or the template's own image class). New sections must reuse the template's grid/card classes so they collapse on small screens the way the template's own sections do.

NEVER INVENT CONTACT DETAILS. The brief lists the phone and email the business has; anything not listed, the business does not have. If the brief has no email, there is no email on the site: remove the mailto: links, the email lines in the top bar, footer and contact page, the email column in contact cards, and any "email us" copy — do not keep the template's address, do not write a plausible one, do not leave "email@example.com". The same for a missing phone, address, map or profile link. A missing detail leaves a cleanly removed element, never an invented one.

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
  if (b.logo) lines.push(`Logo image URL (the header and footer show THIS, not the business name as text): ${b.logo}`);
  if (b.services.length) lines.push(`Services: ${b.services.join(", ")}`);
  if (b.service_areas.length) lines.push(`Service areas: ${b.service_areas.join(", ")}`);
  if (b.color_scheme) lines.push(`Colour scheme: ${b.color_scheme}`);
  if (typeof b.years_experience === "number") lines.push(`Years in business: ${b.years_experience}`);
  if (b.social_profiles?.length) {
    lines.push(
      "Social profiles (the site's social icons/links point at these and ONLY these):",
      ...b.social_profiles.map((p) => `- ${p.platform}: ${p.url}`),
    );
  }
  if (b.form_relay) {
    lines.push(
      "Form endpoint (every contact/booking form posts here — see the FORMS rule):",
      `- Submit URL: ${b.form_relay.submit_url}`,
      `- access_key: ${b.form_relay.access_key}`,
    );
  }
  if (b.about_business) lines.push(`About the business (facts you may use — anything not stated here is off limits):\n${b.about_business}`);
  if (b.instructions) {
    lines.push(
      `
ADDITIONAL INSTRUCTIONS FROM THE OPERATOR — follow these for every page of this site; where they conflict with a general rule above, the instructions win. They never license inventing facts, breaking the template's code, or departing from the required output format:
${b.instructions}`,
    );
  }
  return lines.join("\n");
}

function imagesText(images: SuppliedImage[]): string {
  if (!images.length) return "No images were supplied — keep the template's own images.";
  return [
    "Each image below is used by LINKING to it. Copy the URL into the page EXACTLY as written — character for character, complete, including everything after any '?'. Do not shorten it, do not re-encode it, do not wrap it, and do not download or rename it. An image whose URL is altered in any way will not load.",
    ...images.map((i) => `- ${i.purpose}: ${i.url}`),
  ].join("\n");
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
1. Every trace of the template's demo business: its name, phone numbers, email addresses, street addresses, city and area names, wordmark text, social links, review/testimonial names, copyright line — wherever they appear in string literals or markup inside this file. Social icons/links point at the brief's social profiles; an icon for a network the brief does not list is removed cleanly, never left on the template's own account and never invented.
2. Business identity goes where the template shows its own: phone in tel: links, email in mailto: links. The wordmark is the case to get right: when the brief supplies a logo URL, the header and footer show that logo as an <img> with the business name as its alt text, and the wordmark TEXT must not be visible beside it. A brand area here is usually a mark or coloured shape plus a text span — replacing only the mark and leaving the text is the common mistake, and it is wrong. HIDE that text element, never delete it: keep its tag, id, classes and attributes exactly as they are and add display:none to its style, because the template's other scripts look these ids up and a missing one throws and kills the page's behaviour. When no logo is supplied, the business name goes there as text, styled the way the wordmark was, and nothing is hidden.
3. Navigation must link ONLY to the pages listed for this site, with sensible labels. Remove nav items for pages this site does not have; add items for pages it has that the template's nav lacks, styled the same way.
4. THE SITE THEME. This file begins with a SITE THEME block: a small stylesheet the site injects at load, whose base variables — marked PRIMARY, ACCENT and DARK in comments — are the whole palette; the template's stylesheet derives every shade from them, so setting these lines recolours the entire site. Set them from the brief's colour scheme: the first colour is PRIMARY, the second is ACCENT, a third (or whichever one is a navy, charcoal or black) is DARK; a scheme given in words ("navy and orange") becomes sensible hex values. Change ONLY the base lines. The derived color-mix lines stay exactly as they are, and the block, its id and the code that injects it must survive the rewrite untouched. A single supplied colour is PRIMARY; keep the template's other bases unless they clash with it. If the brief gives no colour scheme, leave the block exactly as it is. Anywhere else this file hard-codes a hex of the template's own palette, use the variable or the brief's colour instead. Services and service areas follow the brief exactly: never pad with invented services.
5. Booking/contact forms keep working exactly as before — same field structure, same submit behaviour, same classes — with only their visible text, labels and destination details (phone/email) rewritten for this business. When the brief gives a form endpoint (submit URL + access_key), the form posts to THAT URL with THAT access_key — replace the template's own destination and key everywhere they appear (action attribute, hidden access_key input, fetch URL, JSON body, formData.append); keep the hidden "botcheck" honeypot field. With no endpoint in the brief, leave the destination exactly as the template had it.
6. Every logo <img> you place carries an explicit size — the template's logo-image class when it has one, AND style="height:44px;width:auto;max-width:220px;object-fit:contain;display:block" (a little smaller in the footer). A logo file is large, and an unsized <img> renders at its natural size and covers the screen.
7. Never invent a contact detail. If the brief has no email, remove every email element this file renders — the mailto: links, the top-bar and footer email lines, any data-mailto attribute value — rather than keeping the template's address or writing a plausible one. The same for a missing phone, address or profile link.
8. A SITE CONTENT block, when this file has one (a window.*_SITE object of rotator words, reviews, proof lines and similar that the template's other scripts animate), is copy like any other and is rewritten for this business: rotator words become the business's own services, reviews become generic and unattributed (no invented named customers), proof lines become true and general (no fabricated events, ratings or review counts). Keep the object's shape and property names exactly; change only the text.

WHAT MUST NOT CHANGE
The code must still run. Keep the file's structure, its custom element names, its exported/global symbols, its event wiring and its DOM APIs intact. You are rewriting the CONTENT the code renders, not refactoring the code. Do not rename, remove or reorder functions or elements that pages depend on.

The ids and classes on the markup this file renders are its contract with the template's OTHER scripts and stylesheets, which you cannot see and which are shipped unchanged. Every id that is here now must still be here, on the same element, when you are done — including on elements you have hidden. Those files call getElementById on them without checking, so an id you drop becomes a TypeError during setup, and one such error stops every animation, menu and form handler on the site.

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
