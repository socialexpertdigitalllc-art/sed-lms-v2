import type { WgeConfig, WgeVariable, WgeSettings } from "./wge-types";

export const DEFAULT_SYSTEM_PROMPT = `You are an elite web developer and designer specialising in premium, production-grade websites.
You output ONLY raw HTML code — never any explanations, markdown fences, commentary, or preamble.
Your output MUST begin with exactly:
<!DOCTYPE html>
It must be a single, complete, 100% functional HTML file.`;

export const DEFAULT_SETTINGS: WgeSettings = {
  max_tokens: 8192,
  temperature: 0.7,
  default_pages: 5,
  auto_download: false,
  auto_generate: false,
  auto_engine: null,
  ready_required: ["name", "services", "pages"],
};

export const DEFAULT_VARIABLES: WgeVariable[] = [
  { key: "name", label: "Business name", type: "text", fallback: "(not provided)", lead_column: "business_name", join: ", " },
  { key: "phone", label: "Phone", type: "text", fallback: "(not provided)", lead_column: "business_phone", join: ", " },
  { key: "email", label: "Email", type: "text", fallback: "(not provided)", lead_column: "business_email", join: ", " },
  { key: "services", label: "Services", type: "text", fallback: "(not provided)", lead_column: "services", join: ", " },
  { key: "exp", label: "Years of experience", type: "number", fallback: "", lead_column: "client_experience", join: ", " },
  { key: "color", label: "Color scheme", type: "text", fallback: "(not provided — use a modern, professional palette relevant to the industry)", lead_column: "color_scheme", join: ", " },
  { key: "profile", label: "Profile / about", type: "textarea", fallback: "(not provided)", lead_column: "comments", join: ", " },
  { key: "pages", label: "Number of pages", type: "number", fallback: "5", lead_column: "num_webpages", join: ", " },
  { key: "pageNames", label: "Specific page names", type: "text", fallback: "", lead_column: "specify_pages", join: ", " },
  { key: "google", label: "Google business profile link", type: "text", fallback: "(not provided)", lead_column: "business_profile_link", join: ", " },
  { key: "map", label: "Map embed link", type: "text", fallback: "(not provided — use a placeholder or omit)", lead_column: "map_embed_link", join: ", " },
  { key: "hero", label: "Hero image links", type: "textarea", fallback: "(not provided — source high-quality Unsplash images relevant to the business)", lead_column: null, join: "\n" },
  { key: "serviceImgs", label: "Service image links", type: "textarea", fallback: "(not provided — source relevant stock images)", lead_column: null, join: "\n" },
  { key: "logo", label: "Logo link", type: "text", fallback: "(not provided — search for a professional logo or generate a text-based logo)", lead_column: "logo_link", join: ", " },
  { key: "imgs", label: "Additional image links", type: "textarea", fallback: "(not provided — source relevant stock images)", lead_column: "image_links", join: "\n" },
  { key: "r1", label: "Reference site 1", type: "text", fallback: "", lead_column: "reference_link", join: ", " },
  { key: "r2", label: "Reference site 2", type: "text", fallback: "", lead_column: null, join: ", " },
  { key: "r3", label: "Reference site 3", type: "text", fallback: "", lead_column: null, join: ", " },
  { key: "r4", label: "Reference site 4", type: "text", fallback: "", lead_column: null, join: ", " },
  { key: "extra", label: "Extra notes / instructions", type: "textarea", fallback: "", lead_column: null, join: ", " },
];

export const DEFAULT_PROMPT_TEMPLATE = `I'm giving you business details in an uncoordinated way. Some spellings may be wrong, but you'll fix that. I want an HTML site. The website should be SEO friendly, UX design and mobile friendliness should be outstanding, and it should have the relevant CTAs. I want you to build it in one go. It should have excellent contrast and professional use of imagery. But most of all, I'm giving you {{ref_count}} sites to look at for design inspiration — this is your PRIMARY guiding factor. I'm also providing the business's Google profile link; add some live testimonials from Google on the site. Each page should have a contact form and a small map section next to it. It should look like a premium site made by a very experienced developer.

SITES FOR REFERENCE (design these as your guiding north star):
{{references}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Business Name: {{name|(not provided)}}
Phone No: {{phone|(not provided)}}
Email: {{email|(not provided)}}
Services: {{services|(not provided)}}
Experience: {{experience}}
Color Scheme: {{color|(not provided — use a modern, professional palette relevant to the industry)}}
Profile / About: {{profile|(not provided)}}
Google Profile Link: {{google|(not provided)}}

Hero Section Background Images (animated slideshow):
{{hero|(not provided — source high-quality Unsplash images relevant to the business)}}

Service Specific Images (use these for the services cards/sections):
{{serviceImgs|(not provided — source relevant stock images)}}

Business Logo Link:
{{logo|(not provided — search for a professional logo or generate a text-based logo)}}

Additional Business Images:
{{imgs|(not provided — source relevant stock images)}}

I want a {{pages}}-page website — Pages: {{page_names}}
Map Embed Link: {{map|(not provided — use a placeholder or omit)}}

Read these first. These override everything else in this prompt.
You WILL generate exactly [NUMBER FROM "Total Pages to Generate"] files in this SINGLE response. No exceptions. Never generate only the home page.
The COMPLETE shared CSS design system from Part 3 MUST be embedded inside a <style> tag in the <head> of EVERY HTML page. No external CSS files.
Generate every HTML file in this exact order: index.html → About → Contact → Services hub → Service detail pages (alphabetical) → Service Areas hub → Area detail pages (alphabetical) → Gallery → Testimonials → FAQ → Privacy.
OUTPUT FORMAT: You MUST use the following delimiters for EACH file so the output can be parsed accurately:
[FILE: index.html]
<!DOCTYPE html>
<html>...</html>
[END_FILE]

[FILE: about.html]
<!DOCTYPE html>
<html>...</html>
[END_FILE]

... and so on for all {{pages}} pages.

Do NOT include markdown code fences (\`\`\`html), explanations, or any text before or after the file blocks. Just the blocks.
Never use hash-based routing. Every link must be href="page-name.html".
Before you begin generating code, write a single line: PAGES TO GENERATE: [N] — [list all filenames]. Then immediately start with the first HTML file using the [FILE: filename.html] format. Do NOT output a separate styles.css file.


PART 3: COMPRESSED DESIGN SYSTEM
The CSS below MUST be embedded inside a <style> tag in the <head> of EVERY HTML page. No external CSS file.
:root {
  --brand-primary: [PRIMARY_COLOR];
  --brand-secondary: [SECONDARY_COLOR];
  --brand-accent: [ACCENT_COLOR];
  --brand-dark: #1a1a1a;
  --brand-light: #f5f5f0;
  --brand-white: #ffffff;
  --brand-gray: #6b6b6b;
  --brand-border: #e0e0e0;
  --font-heading: Georgia, 'Playfair Display', serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --section-padding: clamp(4rem, 8vw, 6rem);
  --container-max: 1200px;
  --container-padding: 1.5rem;
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 20px rgba(0,0,0,0.12);
  --shadow-lg: 0 8px 40px rgba(0,0,0,0.15);
  --radius: 8px;
  --transition: all 0.3s ease;
}
@media (max-width: 768px) {
  :root { --section-padding: 3rem; --container-padding: 1rem; }
}

/* Reset + Base */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { font-family: var(--font-body); font-size: 1.1rem; line-height: 1.7; color: var(--brand-dark); }
img { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.75rem 2rem; font-weight: 600; border-radius: var(--radius); border: 2px solid transparent; cursor: pointer; transition: var(--transition); }
.btn:hover { transform: translateY(-3px); box-shadow: 0 6px 20px rgba(0,0,0,0.15); }
.btn--primary { background: var(--brand-accent); color: white; border-color: var(--brand-accent); }
.btn--primary:hover { background: transparent; color: var(--brand-accent); }
.btn--secondary { background: var(--brand-primary); color: white; border-color: var(--brand-primary); }
.btn--secondary:hover { background: transparent; color: var(--brand-primary); }
.btn--outline { background: transparent; color: white; border-color: white; }
.btn--outline:hover { background: white; color: var(--brand-primary); }
.btn--large { padding: 1rem 2.5rem; font-size: 1.1rem; }
.btn--full { width: 100%; }

/* Layout */
.container { max-width: var(--container-max); margin: 0 auto; padding: 0 var(--container-padding); }
.section { padding: var(--section-padding) 0; }
.section__header { text-align: center; max-width: 700px; margin: 0 auto 3rem; }
.section__label { text-transform: uppercase; letter-spacing: 0.15em; font-size: 0.85rem; color: var(--brand-primary); font-weight: 600; margin-bottom: 0.75rem; display: inline-block; }
.section__title { font-family: var(--font-heading); font-size: clamp(2rem, 4vw, 3rem); color: var(--brand-dark); margin-bottom: 1.5rem; line-height: 1.2; }
.section__desc { font-size: 1.1rem; color: var(--brand-gray); }

/* Top Bar */
.top-bar { background: var(--brand-dark); color: white; padding: 0.6rem 0; font-size: 0.95rem; }
.top-bar .container { display: flex; justify-content: space-between; align-items: center; }
.top-bar__left { display: flex; gap: 1.5rem; }
.top-bar__link { color: white; display: flex; align-items: center; gap: 0.4rem; transition: var(--transition); }
.top-bar__link:hover { color: var(--brand-accent); }
@media (max-width: 768px) { .top-bar__left { flex-direction: column; gap: 0.3rem; } .top-bar .container { flex-direction: column; align-items: flex-start; } }

/* Navbar */
.navbar { background: var(--brand-white); box-shadow: var(--shadow-sm); position: sticky; top: 0; z-index: 1000; }
.navbar .container { display: flex; align-items: center; justify-content: space-between; height: 80px; }
.logo { display: flex; align-items: center; gap: 0.5rem; font-family: var(--font-heading); font-size: 1.5rem; font-weight: 700; color: var(--brand-dark); }
.logo img { height: 50px; width: auto; }
.nav { display: flex; align-items: center; gap: 2rem; }
.nav__link { color: var(--brand-dark); font-weight: 500; font-size: 1rem; transition: var(--transition); position: relative; padding: 0.5rem 0; }
.nav__link:hover, .nav__link.active { color: var(--brand-primary); }
.nav__link::after { content: ''; position: absolute; bottom: 0; left: 0; width: 0; height: 2px; background: var(--brand-primary); transition: width 0.3s ease; }
.nav__link:hover::after, .nav__link.active::after { width: 100%; }
.navbar__cta { padding: 0.6rem 1.5rem; font-size: 0.95rem; }
.nav__toggle { display: none; background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--brand-dark); }
.nav-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 998; opacity: 0; transition: opacity 0.3s ease; pointer-events: none; }
body.nav-open .nav-overlay { display: block; opacity: 1; pointer-events: all; }
@media (max-width: 768px) {
  .nav { position: fixed; top: 80px; left: -100%; width: 80%; max-width: 300px; height: calc(100vh - 80px); background: white; flex-direction: column; padding: 2rem; box-shadow: var(--shadow-lg); transition: left 0.35s cubic-bezier(0.4,0,0.2,1); z-index: 999; align-items: flex-start; gap: 1.5rem; }
  .nav.active { left: 0; }
  .nav__toggle { display: block; }
  .navbar__cta { display: none; }
}

/* Hero */
.hero { position: relative; min-height: 90vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.hero__bg { position: absolute; inset: 0; background-size: cover; background-position: center; z-index: 1; }
.hero__bg.active { animation: kenBurns 8s ease-out forwards; }
@keyframes kenBurns { 0% { transform: scale(1); } 100% { transform: scale(1.08); } }
.hero__overlay { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0.75)); z-index: 2; }
.hero__content { position: relative; z-index: 3; text-align: center; max-width: 800px; padding: var(--container-padding); color: white; }
.hero__label { text-transform: uppercase; letter-spacing: 0.15em; font-size: 0.9rem; margin-bottom: 1rem; opacity: 0; transform: translateY(20px); animation: fadeUp 0.6s ease-out 0.2s forwards; display: inline-block; color: var(--brand-accent); font-weight: 600; }
.hero__title { font-family: var(--font-heading); font-size: clamp(2.5rem, 5vw, 4rem); line-height: 1.2; margin-bottom: 1.5rem; font-weight: 700; opacity: 0; transform: translateY(20px); animation: fadeUp 0.6s ease-out 0.4s forwards; }
.hero__subtitle { font-size: 1.25rem; line-height: 1.6; margin-bottom: 2.5rem; opacity: 0; transform: translateY(20px); animation: fadeUp 0.6s ease-out 0.6s forwards; max-width: 600px; margin-left: auto; margin-right: auto; }
.hero__ctas { display: flex; align-items: center; justify-content: center; gap: 0; flex-wrap: wrap; opacity: 0; transform: translateY(20px); animation: fadeUp 0.6s ease-out 0.8s forwards; }
@keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
.cta-divider { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: white; color: var(--brand-dark); border-radius: 50%; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; margin: 0 -8px; z-index: 2; position: relative; box-shadow: var(--shadow-sm); }
@media (max-width: 768px) { .hero { min-height: 80vh; } .hero__ctas { flex-direction: column; gap: 0.75rem; } .cta-divider { display: none; } }

/* Trust Bar */
.trust-bar-section { background: var(--brand-primary); padding: 3rem 0; position: relative; z-index: 5; }
.trust-bar__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2rem; text-align: center; }
.trust-item { color: white; padding: 0 1rem; position: relative; }
.trust-item:not(:last-child)::after { content: ''; position: absolute; right: 0; top: 10%; height: 80%; width: 1px; background: rgba(255,255,255,0.25); }
.trust-item__number { font-family: var(--font-heading); font-size: 2.8rem; font-weight: 700; display: block; line-height: 1; }
.trust-item__label { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.9; display: block; margin-top: 0.25rem; }
.trust-item__stars { color: #ffc107; font-size: 1.3rem; letter-spacing: 2px; display: block; }
.trust-item__rating { font-family: var(--font-heading); font-size: 1.8rem; font-weight: 700; display: block; }
@media (max-width: 768px) { .trust-bar__grid { grid-template-columns: repeat(2, 1fr); gap: 1.5rem; } .trust-item:not(:last-child)::after { display: none; } .trust-item__number { font-size: 2.2rem; } }

/* About */
.section--about { background: var(--brand-light); }
.about__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center; }
.about__content p { margin-bottom: 1rem; font-size: 1.1rem; color: rgba(26,26,26,0.85); }
.checklist { list-style: none; padding: 0; margin: 1.5rem 0; }
.checklist li { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; font-weight: 500; }
.check { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: var(--brand-primary); color: white; border-radius: 50%; font-size: 0.85rem; flex-shrink: 0; }
.about__images { position: relative; }
.about__img { border-radius: var(--radius); box-shadow: var(--shadow-md); object-fit: cover; }
.about__img--main { width: 85%; height: 450px; }
.about__img--accent { width: 50%; height: 200px; position: absolute; bottom: -20px; right: 0; border: 4px solid var(--brand-white); }
.experience-badge { position: absolute; top: 2rem; right: 2rem; background: var(--brand-primary); color: white; padding: 1.5rem 2rem; border-radius: var(--radius); text-align: center; box-shadow: var(--shadow-lg); animation: gentlePulse 3s ease-in-out infinite; }
@keyframes gentlePulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
.experience-badge__number { font-family: var(--font-heading); font-size: 3rem; font-weight: 700; display: block; line-height: 1; }
.experience-badge__text { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.1em; }
@media (max-width: 768px) { .about__grid { grid-template-columns: 1fr; gap: 2rem; } .about__img--main { width: 100%; height: 300px; } .about__img--accent { display: none; } .experience-badge { position: relative; top: auto; right: auto; margin: 1rem 0; display: inline-block; } }

/* Services */
.section--services { background: var(--brand-white); }
.services__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; }
.service-card { background: var(--brand-white); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-sm); transition: var(--transition); border: 1px solid var(--brand-border); display: flex; flex-direction: column; }
.service-card:hover { transform: translateY(-6px); box-shadow: var(--shadow-lg); }
.service-card__image { height: 220px; overflow: hidden; }
.service-card__image img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
.service-card:hover .service-card__image img { transform: scale(1.05); }
.service-card__content { padding: 1.5rem; flex: 1; display: flex; flex-direction: column; }
.service-card__title { font-family: var(--font-heading); font-size: 1.3rem; margin-bottom: 0.75rem; color: var(--brand-dark); }
.service-card__content p { color: var(--brand-gray); font-size: 0.95rem; line-height: 1.7; margin-bottom: 1rem; flex: 1; }
.link-arrow { color: var(--brand-primary); font-weight: 600; font-size: 0.95rem; transition: var(--transition); display: inline-flex; align-items: center; gap: 0.25rem; }
.link-arrow:hover { color: var(--brand-secondary); padding-left: 4px; }

/* Why Choose Us */
.section--why { background: var(--brand-light); }
.why__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem; margin-top: 2rem; }
.why-card { text-align: center; padding: 2rem 1.5rem; background: var(--brand-white); border-radius: var(--radius); box-shadow: var(--shadow-sm); border: 1px solid var(--brand-border); }
.why-card__icon { width: 64px; height: 64px; background: var(--brand-primary); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; }
.why-card__icon svg { width: 28px; height: 28px; fill: white; }
.why-card h3 { font-family: var(--font-heading); font-size: 1.2rem; margin-bottom: 0.75rem; color: var(--brand-dark); }
.why-card p { color: var(--brand-gray); font-size: 0.95rem; line-height: 1.7; }

/* Projects */
.section--projects { background: var(--brand-dark); color: white; }
.section--projects .section__title { color: white; }
.section--projects .section__desc { color: rgba(255,255,255,0.7); }
.projects__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
.project-card { position: relative; border-radius: var(--radius); overflow: hidden; aspect-ratio: 4/3; cursor: pointer; }
.project-card img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
.project-card:hover img { transform: scale(1.1); }
.project-card__overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent 60%); display: flex; flex-direction: column; justify-content: flex-end; padding: 1.5rem; color: white; opacity: 0; transition: opacity 0.3s ease; }
.project-card:hover .project-card__overlay { opacity: 1; }
.project-card__overlay h3 { font-family: var(--font-heading); font-size: 1.3rem; margin-bottom: 0.25rem; }
.project-card__overlay p { font-size: 0.95rem; opacity: 0.9; }

/* Testimonials */
.section--testimonials { background: var(--brand-white); }
.testimonials__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; }
.testimonial-card { background: var(--brand-light); padding: 2rem; border-radius: var(--radius); position: relative; border: 1px solid var(--brand-border); }
.testimonial-card__stars { color: #ffc107; font-size: 1.2rem; letter-spacing: 2px; margin-bottom: 1rem; }
.testimonial-card__text { font-style: italic; line-height: 1.7; margin-bottom: 1.5rem; color: var(--brand-dark); }
.testimonial-card__author strong { display: block; color: var(--brand-dark); }
.testimonial-card__author span { font-size: 0.95rem; color: var(--brand-gray); }

/* CTA Banner */
.section--cta { background: linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-secondary) 100%); background-size: 200% 200%; animation: gradientShift 8s ease infinite; color: white; padding: 4rem 0; }
@keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
.cta-banner { display: flex; align-items: center; justify-content: space-between; gap: 2rem; flex-wrap: wrap; }
.cta-banner h2 { font-family: var(--font-heading); font-size: clamp(2rem, 4vw, 3rem); margin-bottom: 0.5rem; color: white; }
.cta-banner p { opacity: 0.95; font-size: 1.1rem; }
.cta-banner__actions { display: flex; gap: 1rem; flex-wrap: wrap; }
.section--cta .btn--outline { border-color: white; color: white; }
.section--cta .btn--outline:hover { background: white; color: var(--brand-primary); }
@media (max-width: 768px) { .cta-banner { flex-direction: column; text-align: center; } }

/* Contact */
.section--contact { background: var(--brand-light); }
.contact__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; }
.contact__item { margin-bottom: 1.5rem; }
.contact__item h4 { font-family: var(--font-heading); font-size: 1.1rem; margin-bottom: 0.5rem; color: var(--brand-dark); }
.contact__item a { color: var(--brand-primary); font-size: 1.1rem; }
.contact__item a:hover { text-decoration: underline; }
.contact__item p { color: var(--brand-gray); }
.contact__form form { background: white; padding: 2rem; border-radius: var(--radius); box-shadow: var(--shadow-sm); }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
.contact__form input, .contact__form textarea { width: 100%; padding: 0.875rem; border: 1px solid var(--brand-border); border-radius: 4px; font-family: var(--font-body); font-size: 1rem; transition: var(--transition); }
.contact__form input:focus, .contact__form textarea:focus { outline: none; border-color: var(--brand-primary); box-shadow: 0 0 0 3px rgba(0,0,0,0.05); }
.contact__form textarea { resize: vertical; margin-bottom: 1rem; }
@media (max-width: 768px) { .contact__grid { grid-template-columns: 1fr; gap: 2rem; } .form__row { grid-template-columns: 1fr; } }

/* Footer */
.footer { background: var(--brand-dark); color: white; padding: var(--section-padding) 0 2rem; }
.footer__grid { display: grid; grid-template-columns: 2fr 1fr 1.5fr 1.5fr; gap: 3rem; margin-bottom: 3rem; }
.footer__brand .logo__text { font-family: var(--font-heading); font-size: 1.5rem; font-weight: 700; display: block; margin-bottom: 1rem; color: white; }
.footer__brand p { color: rgba(255,255,255,0.7); margin-bottom: 1.5rem; font-size: 0.95rem; }
.footer h4 { font-family: var(--font-heading); font-size: 1.1rem; margin-bottom: 1rem; color: white; }
.footer a { display: block; color: rgba(255,255,255,0.7); margin-bottom: 0.5rem; font-size: 0.95rem; transition: var(--transition); }
.footer a:hover { color: var(--brand-accent); padding-left: 4px; }
.footer__contact p { color: rgba(255,255,255,0.7); font-size: 0.95rem; margin-bottom: 0.5rem; }
.footer__bottom { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 2rem; display: flex; justify-content: space-between; font-size: 0.85rem; color: rgba(255,255,255,0.5); }
@media (max-width: 768px) { .footer__grid { grid-template-columns: 1fr 1fr; gap: 2rem; } .footer__bottom { flex-direction: column; gap: 0.5rem; text-align: center; } }

/* Page Hero (interior pages) */
.page-hero { position: relative; min-height: 50vh; display: flex; align-items: flex-end; padding-bottom: 4rem; }
.page-hero__bg { position: absolute; inset: 0; background-size: cover; background-position: center; z-index: 1; animation: kenBurns 20s ease-in-out infinite alternate; }
.page-hero__overlay { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.7)); z-index: 2; }
.page-hero .container { position: relative; z-index: 3; color: white; }
.breadcrumbs { font-size: 0.95rem; color: rgba(255,255,255,0.8); margin-bottom: 1rem; }
.breadcrumbs a { color: var(--brand-accent); text-decoration: none; }
.breadcrumbs a:hover { text-decoration: underline; }
.page-hero h1 { font-family: var(--font-heading); font-size: clamp(2.5rem, 5vw, 4rem); margin: 1rem 0; }
.page-hero p { font-size: 1.2rem; max-width: 600px; opacity: 0.95; }

/* Service Detail */
.service-detail__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: start; }
.service-detail__content h2 { font-family: var(--font-heading); font-size: clamp(2rem, 4vw, 3rem); margin-bottom: 1rem; }
.service-detail__content h3 { font-family: var(--font-heading); font-size: 1.5rem; margin: 2rem 0 1rem; }
.service-detail__image img { width: 100%; border-radius: var(--radius); box-shadow: var(--shadow-md); }
.why-mini__grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; text-align: center; }
.why-mini__item { padding: 1.5rem; }
.why-mini__item h4 { font-family: var(--font-heading); margin-bottom: 0.5rem; }
@media (max-width: 768px) { .service-detail__grid { grid-template-columns: 1fr; gap: 2rem; } .why-mini__grid { grid-template-columns: 1fr; } }

/* City/Area Page Sidebar */
.service-detail__sidebar { display: flex; flex-direction: column; gap: 1.5rem; }
.sidebar-card { background: var(--brand-light); padding: 1.5rem; border-radius: var(--radius); }
.sidebar-card h4 { font-family: var(--font-heading); margin-bottom: 0.75rem; }
.sidebar-card p { font-size: 0.95rem; color: var(--brand-gray); margin-bottom: 1rem; }
.sidebar-card a:not(.btn) { display: block; color: var(--brand-primary); padding: 0.4rem 0; font-size: 0.95rem; transition: var(--transition); }
.sidebar-card a:not(.btn):hover { padding-left: 4px; }

/* Scroll Reveal */
.reveal { opacity: 0; transform: translateY(30px); transition: opacity 0.6s ease, transform 0.6s ease; }
.reveal.active { opacity: 1; transform: translateY(0); }
.section__label.reveal { opacity: 0; transform: translateX(-20px); transition: opacity 0.5s ease, transform 0.5s ease; display: inline-block; }
.section__label.reveal.active { opacity: 1; transform: translateX(0); }

PART 4: PAGE STRUCTURE RULES (Minimal — No Full Templates)
Build each page using the CSS classes above. Do NOT output full template examples — just build the real page with real content.
Page Types & Required Sections:
- Home (max 800 words): Top Bar, Navbar, Hero, Trust Bar, About Preview, Services Preview (3-6 cards), Why Choose Us (3-4 cards), Projects Preview (3-6), Testimonials (3), CTA Banner, Footer
- About (max 500 words): Page Hero, Our Story (2 paragraphs), Values/Why (3 cards), CTA Banner, Footer
- Contact (max 300 words): Page Hero, Contact Grid (info + form), Map Embed, Footer
- Services Hub (max 400 words): Page Hero, Service Cards Grid (all services), CTA Banner, Footer
- Service Detail (max 500 words): Page Hero, 2-3 paragraphs, What's Included checklist (4-6 items), Mini Why (3 items), CTA Banner, Related Services (3 cards), Footer
- Service Areas Hub (max 300 words): Page Hero, Area List/Map, CTA Banner, Footer
- Area Detail (max 400 words): Page Hero, 2 paragraphs about city, Areas We Serve list (5 items), Map Embed, Sidebar CTA, Footer
- Gallery (max 200 words): Page Hero, Photo Grid, Footer
- Testimonials (max 300 words): Page Hero, Testimonial Cards (all reviews), Footer
- FAQ (max 400 words): Page Hero, FAQ Accordion (5-8 items), Footer
- Privacy / Terms (max 600 words): Page Hero, Minimal styled text (template legal copy), Footer

Rules for ALL pages: Include Top Bar, Navbar, and Footer on every page. Only the .active nav class changes. Every page embeds the complete CSS (Part 3) inside a <style> tag in the <head>. No external CSS files. Every page includes the scroll reveal JS snippet at the bottom. All phone numbers use href="tel:+1...". All internal links use relative .html paths. Every page has unique <title> and <meta name="description">. Apply class="reveal" to section headers, cards, and grid items. The footer should have @2026 as the year. Every page should have a booking form. The footer should contain "Powered by Social Expert Digital" with socialexpertdigital.com linked to it and opening in a new tab. The booking form should collect and gather as much detail and information as possible, organised into sections (first services needed, then budget and timeframe, then personal details, etc.).

PART 5: ANTI-PATTERNS (STRICTLY FORBIDDEN)
NO dark themes by default. Light themes only unless explicitly requested.
NO purple, blue, or rainbow gradients. Solid colors and photo overlays only.
NO Inter or Roboto as display fonts. Use the font stack defined in CSS variables.
NO vector illustrations or 3D blobs. Real photography only.
NO placeholder text (Lorem Ipsum). Every sentence must be real content.
NO hash-based routing. Every page is a separate .html file.
NO skipping heading levels (H1 → H2 → H3).
NO "Submit" as CTA text. Use "Get My Free Quote," "Send Message," etc.

PART 6: SHARED JS SNIPPET (Embed at bottom of every HTML page)
<script>
// Scroll reveal
const revealElements = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('active'); revealObserver.unobserve(entry.target); }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
revealElements.forEach(el => revealObserver.observe(el));

// Mobile nav
const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('mainNav');
const navOverlay = document.getElementById('navOverlay');
if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => { mainNav.classList.toggle('active'); document.body.classList.toggle('nav-open'); });
  mainNav.querySelectorAll('.nav__link').forEach(link => {
    link.addEventListener('click', () => { mainNav.classList.remove('active'); document.body.classList.remove('nav-open'); });
  });
}
if (navOverlay) {
  navOverlay.addEventListener('click', () => { mainNav.classList.remove('active'); document.body.classList.remove('nav-open'); });
}

// Counter animation (trust bar)
const counters = document.querySelectorAll('[data-count]');
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const target = parseInt(entry.target.dataset.count);
      const duration = 2000;
      const start = performance.now();
      const step = (timestamp) => {
        const elapsed = timestamp - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        entry.target.textContent = Math.floor(eased * target);
        if (progress < 1) requestAnimationFrame(step);
        else entry.target.textContent = target;
      };
      requestAnimationFrame(step);
      counterObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });
counters.forEach(c => counterObserver.observe(c));
<\/script>

PART 7: JSON-LD STRUCTURED DATA (Include on every page)
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "[BUSINESS_NAME]",
  "telephone": "[PHONE]",
  "email": "[EMAIL]",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "[CITY]",
    "addressRegion": "[STATE]",
    "addressCountry": "US"
  },
  "priceRange": "$$",
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"],
      "opens": "[OPEN_TIME]",
      "closes": "[CLOSE_TIME]"
    }
  ],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "[GOOGLE_RATING]",
    "reviewCount": "[NUMBER_OF_REVIEWS]"
  }
}
<\/script>

START GENERATING NOW.`;

export const DEFAULT_WGE_CONFIG: WgeConfig = {
  system_prompt: DEFAULT_SYSTEM_PROMPT,
  prompt_template: DEFAULT_PROMPT_TEMPLATE,
  variables: DEFAULT_VARIABLES,
  settings: DEFAULT_SETTINGS,
};
