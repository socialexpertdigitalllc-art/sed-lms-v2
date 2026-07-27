# SOP 04 — Authoring a template Site Studio accepts first time

These rules are derived from the compiler itself, not from style preference. A template that follows them compiles with zero blockers and needs no rework. The section at the bottom is a **ready-to-paste brief for a template-generating AI**.

## Why these rules exist

Site Studio compiles a template **once** into a package: tokenized HTML skeletons plus a manifest of sample content. Certification requires that `render(compile(zip), samples)` reproduces the original site — if the compiler can't put the template back together byte-for-byte, it refuses to certify. Every rule below exists because breaking it either fails that check or silently makes content uneditable.

## The ten hard rules

### 1. All visible content lives in HTML. JavaScript may not write to the DOM.
The compiler tokenizes HTML only. Anything JS injects at runtime ships to the client's site **verbatim, with the template's demo business in it**.

Banned in any `.js` file: `innerHTML`, `outerHTML =`, `document.write`, `insertAdjacentHTML`, `customElements.define`, and jQuery-style `.html()`, `.append()`, `.prepend()`.

JS is welcome for behaviour that only toggles classes or styles: accordions, sliders, scroll reveals, form validation, mobile-menu open/close.

### 2. Never put the business name, phone, or email in a `.js` or `.css` file.
Identity belongs in HTML only, where it can be tokenized. A phone number hardcoded in `components.js` becomes a demo-identity leak on a live client site.

### 3. Nav must be a real HTML list.
Detection looks for `<ul>` or `<ol>` where **each `<li>` contains exactly one `<a>`**. Anything else — a row of `<div>`s, JS-built nav — is not recognised, and its links degrade to plain content.

```html
<nav><ul>
  <li><a href="index.html">Home</a></li>
  <li><a href="services.html">Services</a></li>
</ul></nav>
```

### 4. Every editable string gets its own block element containing only text and inline tags.
An element becomes editable only if it is not inline and **every** descendant element is inline (`b i em strong span br small`). A block containing another block, a link, or a button is structural — its own loose text becomes *stranded* and uneditable.

```html
<!-- GOOD: each string is its own leaf -->
<h2>Kitchen Remodeling</h2>
<p>Fixed price, in writing, before we start.</p>
<p>Or call</p><a href="tel:5552104400">(555) 210-4400</a>

<!-- BAD: "Or call" is stranded — the div also contains a link -->
<div>Or call <a href="tel:5552104400">(555) 210-4400</a></div>
```

### 5. Repeated cards must be structurally AND attribute-identical.
A run of 3+ sibling elements with matching tags, classes and **attributes** becomes an editable repeat region. If rows differ in any attribute — a different inline `style`, an `onclick` on only one card, `data-open="0"` on the first — the run is rejected and left as flat content.

Vary only the **text** between cards. Put styling in shared classes, not per-card inline styles. If one card must behave differently (a clickable card, a "featured" card), give **every** card the same attribute so they stay uniform.

### 6. Every `<img>` needs an `alt`.
Alt text becomes an editable text slot paired with the image. A missing `alt` is flagged and leaves that image without editable alt copy. Prefer local files in the zip (`img/hero.jpg`) over hot-linked external URLs.

### 7. Define your palette as CSS custom properties in `:root`.
This is detected as `css_vars` mode and lets an operator retint the whole site from the cockpit.

```css
:root { --brand:#1d4ed8; --accent:#e11d2a; --ink:#07152b; }
```

Scattered hex literals still work (a weaker `literal_remap` mode); no consistent colours means no theme control at all.

### 8. Filenames decide page type. First match wins, so order matters.

| Filename contains | Becomes |
|---|---|
| `index.` | home |
| `about` | about |
| `contact` | contact |
| `gallery`, `portfolio`, `project` | gallery |
| `review`, `testimonial` | reviews |
| `area`, `location`, `cities` | service areas |
| `service` | services |
| anything else | generic |

`area` is matched **before** `service`, so `service-areas.html` is correctly a service-areas page. Use plain, predictable names: `index.html`, `about.html`, `services.html`, `service-areas.html`, `gallery.html`, `contact.html`.

### 9. A logo/brand link, if you want one, must be a text LEAF inside `<header>`/`<footer>`.

A client's logo can only replace a business-name wordmark if the compiler can find it. Detection is narrow, on purpose — a false positive rewrites the wrong element on every page of every client site:

- the element must be a **leaf** (no element children of its own — a wrapper `<div>` holding the wordmark *and* something else is never swallowed whole);
- it must sit inside a `<header>` or `<footer>` landmark;
- it must carry non-empty text; and it must EITHER
  - have an `id`/`class` naming it, containing the word `logo` or `brand` (e.g. `<a class="logo" href="index.html">Acme Co</a>`), OR
  - show, as its complete text, the business name or its first word (a stylized short wordmark — `NORTHPOINT` for a business named "Northpoint Remodeling").

```html
<!-- GOOD: either shape is detected -->
<a class="logo" href="index.html">Acme Co</a>
<span id="site-logo">ACME</span>

<!-- BAD: wrapped in something with sibling content, or outside header/footer -->
<a href="index.html"><span class="dot"></span><span>ACME</span></a>  <!-- inside <header>, but the <a> itself has no hook and isn't the leaf -->
```

If found, the element is tokenized as `{{brand}}` (not `{{id:business_name}}`): a client with a logo image gets `<img src="…" alt="…">` there; a client without one gets their own business name instead of the template's demo wordmark. **A template may have at most one distinct brand wordmark text** — if a second header/footer candidate's text doesn't byte-match the first one found, it is left untouched and reported (`identity_brand_mismatch`), never guessed at.

### 10. At most one map iframe and one Google-profile iframe, distinguished by which demo URL they point at.

A Google Maps `<iframe>` (rule 8's "also worth doing") tokenizes as `{{id:map_embed}}` — the FIRST iframe found whose `src` contains `google.com/maps`. A page is free to carry a SECOND map-shaped iframe of its own (e.g. a per-neighborhood area page embedding its own local map alongside the shared main-location map) — every iframe shaped like a maps query embed is still "a map," never a profile, however different its query string is.

A **profile** iframe — a reviews/business-profile widget, genuinely not a map — tokenizes as `{{id:profile_embed}}` instead, but only when it is BOTH: on a recognized Google domain (`google.com`, `maps.google.com`, `g.page`, `goo.gl/maps`, `maps.app.goo.gl`, `business.google.com`) AND does NOT itself contain `google.com/maps` in its `src`. Point it at a domain like `g.page` (a Business Profile short link), not a `maps.google.com/maps?...` query URL — that shape is reserved for maps. A client's own map link (`map_embed_link`) and Google Business Profile link (`business_profile_link`) are kept and embedded separately — **the locked decision: the map iframe always keeps using `map_embed_link`**, the profile embeds on its own, and neither ever substitutes for the other.

## Also worth doing

- Put the demo business name in every page's `<title>` as `Business Name | Tagline` — the home page title is where the business name is detected.
- Use real `tel:` and `mailto:` links; both are tokenized so a client's own number and address replace them.
- Keep the demo phone in one consistent format everywhere. Two formats read as two different numbers.
- A Google Maps `<iframe>` embed is tokenized — include one on the contact page.
- HTML comments are stripped at compile time. Harmless, but don't rely on them.

## Two current limitations to design around

1. **Link and button labels are not editable.** `<a>` elements are never text slots, so a CTA's own text is fixed at whatever the template ships. Write CTA copy that suits any business — "Get a free estimate", "See our work" — never anything trade-specific.
2. **Fan-out pages need a labelling pass.** Filenames alone can't mark a page as a *single* service or area page (the kind that gets stamped once per client service). Ship one representative `service-*.html` and one `area-*.html`, then run the AI page-kind pass after upload to enable fan-out.

## Identity facts beyond the lead's own fields are fine

A template isn't limited to the fixed set of facts a lead record holds (business name, phone, email, map link, ...). Anything else the compiler's identity passes find in the demo copy — a neighborhood name, an owner's name, a social handle — becomes its own `{{id:*}}` fact just the same, even though no lead column will ever supply it automatically. That's expected, not a compile error: at run time the operator fills each such fact in (or explicitly leaves it blank) at Gate 1's "Site facts" panel, per run — see SOP 02 §2. Nothing about authoring a template needs to change to accommodate this; it's handled entirely on the generation side.

---

## Paste this into your template-generating AI

> Build a complete, static, multi-page marketing website for a single local-services business. It must satisfy every rule below exactly — these are hard compiler constraints, not stylistic preferences.
>
> **Structure.** Plain filenames: `index.html`, `about.html`, `services.html`, `service-areas.html`, `gallery.html`, `contact.html`, plus one `service-<name>.html` and one `area-<name>.html`. One stylesheet at `css/style.css`. Local images under `img/`. Optionally one `js/script.js`.
>
> **JavaScript.** All visible content must exist in the HTML source. JavaScript may ONLY add or remove classes and inline styles — accordions, sliders, scroll reveals, mobile menu, form validation. It must never contain `innerHTML`, `outerHTML =`, `document.write`, `insertAdjacentHTML`, `customElements.define`, `.html()`, `.append()` or `.prepend()`. Never build the header, nav, or footer in JavaScript.
>
> **Identity.** The business name, phone number and email address may appear ONLY in HTML — never in a `.js` or `.css` file. Use one consistent phone format throughout. Use real `tel:` and `mailto:` links. Put `Business Name | Tagline` in every page's `<title>`. Include a Google Maps iframe on the contact page.
>
> **Navigation.** Every page's nav must be `<nav><ul><li><a href="…">Label</a></li>…</ul></nav>` — exactly one `<a>` per `<li>`. Never use `<div>`s for nav.
>
> **Text.** Every piece of visible copy must sit in its own block element (`h1`–`h6`, `p`, `li`, `figcaption`, `blockquote`) whose only descendants are inline tags (`b i em strong span br small`). Never leave loose text inside an element that also contains a link, button, or another block — split it into a separate `<p>` instead.
>
> **Repeated cards.** Card grids, service lists, FAQ items and testimonials must be runs of 3 or more sibling elements that are identical in tag, classes AND every attribute — differing ONLY in their text content. Do not give one card an extra `onclick`, a different inline `style`, or a `data-open` attribute the others lack. Put all styling in shared CSS classes; avoid inline `style` attributes on repeated elements entirely.
>
> **Images.** Every `<img>` must have a descriptive `alt` attribute. Use local files under `img/`, never hot-linked external URLs.
>
> **Colours.** Define the whole palette as CSS custom properties in a `:root` block in `css/style.css` (e.g. `--brand`, `--accent`, `--ink`, `--line`) and reference them with `var(--brand)` everywhere. Never hardcode the same colour as a literal in multiple places.
>
> **Call-to-action copy.** Link and button labels are fixed after compilation, so write them so they suit any business in the trade — "Get a free estimate", "See our work". Never put trade-specific claims in a link label.
>
> **Never invent credentials.** No licence numbers, insurance claims, award names, years-in-business, review counts or prices anywhere in the demo content. Use neutral placeholder copy that reads naturally but asserts nothing verifiable.
>
> Deliver a zip with the HTML files at the archive root, plus `css/`, `img/` and optional `js/` folders.
