/* ==========================================================================
   Shared components — header, phone menu, call-to-action band, footer and the
   phone quick bar. Every page loads this file and drops in <app-header>,
   <app-cta> and <app-footer>; they are drawn from SDHOME_SITE below. To change
   the business, change the DATA. The code under "RENDERING" is the template's
   engine: keep it as it is.

   Text in SDHOME_SITE is plain text (write & not &amp;). Leave a value as ""
   (or [] for lists) to leave that element out — the code skips whatever is
   empty, so a business with no email simply has no email anywhere.

   FIXED: the home page hero plays the template's own background video on every
   site. script.js puts it inside <div class="hero__media" data-hero-media>.
   Keep that element empty and in place; never add an image or video to it.

   PHOTOS: every photo is a plain <img> and may be swapped. The 3D effects read
   the <img> on the page, so a new photo gets the same effects.

   ICONS: <i data-i="name"> is drawn by script.js. Names available:
   phone, phone-call, mail, map-pin, map, navigation, arrow-right, arrow-left,
   arrow-up, arrow-down, arrow-up-right, check, circle-check, wrench, hammer, house,
   shield-check, clock, sparkles, message-circle, calendar-check, calendar,
   clipboard-list, search, settings, cog, leaf, sprout, droplets, zap,
   paintbrush, brush, ruler, truck, car, thumbs-up, handshake, hand-heart,
   heart, users, quote, plus, x, menu, chevron-right, chevron-left,
   chevron-down, chevron-up, send, hard-hat, construction, key, lock,
   lightbulb, layers, gauge, sun, snowflake, flame, wind, scissors, package,
   building-2, factory, store, camera, image, zoom-in, target, eye, tag,
   award, bug, trash-2, globe, link, music, pin, star, asterisk, briefcase,
   ticket-percent, headset, banknote, file-text, paperclip, bookmark, play,
   facebook, instagram, x-twitter, linkedin, youtube
   ========================================================================== */

/* ---- SITE THEME ---------------------------------------------------------
   The whole palette. style.css derives every other shade from these three. */
const SITE_THEME = `
:root {
  --brand: #f07f2e;     /* PRIMARY — buttons, the progress bar, highlighted words on night */
  --accent: #b9520f;    /* ACCENT — highlighted words, icons and plan lines on the paper */
  --ink-deep: #0f2236;  /* DARK — hero, dark sections, footer, menu */
}
`;

/* ---- SITE CONTENT -------------------------------------------------------- */
window.SDHOME_SITE = {
  name: "Homeward",
  tagline: "Maintenance & Repairs",
  blurb: "Home maintenance, repairs and remodeling.",
  phone: "(555) 123-4567",
  email: "hello@homeward.example",
  area: "the greater metro area",
  logo: "",      /* a direct image URL; when set it replaces the wordmark */
  cta: {
    title: "Tell us what needs doing.",
    highlight: "needs",   /* a word of the title shown in italics */
    text: "A short note is enough. Call, or send the form and we will get back to you to talk through the job and the price.",
    button: "Get a quote",
    image: "media/living/living-sofa.webp"
  },
  nav: [
    { label: "Home", href: "index.html" },
    { label: "About", href: "about.html" },
    { label: "Services", href: "services.html" },
    { label: "Work", href: "gallery.html" },
    { label: "Service Areas", href: "service-areas.html" },
    { label: "Contact", href: "contact.html" }
  ],
  /* The quick picks on the quote card; each opens the contact form with that job chosen. */
  services: ["Handyman & repairs", "AC & heating", "Painting", "Floors & tile", "Kitchen & bath remodels"],
  social: [
    { platform: "Facebook", url: "https://www.facebook.com/" },
    { platform: "Instagram", url: "https://www.instagram.com/" }
  ]
};

/* ==== RENDERING ========================================================== */
(function () {
  "use strict";

  /* Theme first, at the end of <head>, so the colours are in place before paint. */
  var themeTag = document.createElement("style");
  themeTag.id = "site-theme";
  themeTag.textContent = SITE_THEME;
  document.head.appendChild(themeTag);
  document.documentElement.classList.add("js");

  var S = window.SDHOME_SITE || {};
  var CTA = S.cta || {};

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function tel(p) { return "tel:" + String(p).replace(/[^\d+]/g, ""); }
  function title(text, word) {
    var t = String(text || ""), i = word ? t.indexOf(word) : -1;
    return i < 0 ? esc(t) : esc(t.slice(0, i)) + "<em>" + esc(word) + "</em>" + esc(t.slice(i + word.length));
  }

  var here = (location.pathname.split("/").pop() || "index").replace(/\.html?$/i, "") || "index";
  function isHere(href) { return String(href).replace(/\.html?$/i, "") === here; }

  var MARK = '<path class="mk-r" d="M3.5 14.5 16 4.5l12.5 10" stroke-width="3"/><path d="M7.5 15.5v12h17v-12" stroke-width="2.4"/><path d="M21.79 18.79A2.2 2.2 0 1 1 19.41 16.41M18.04 20.16 12.6 25.6" stroke-width="2.4"/>';
  function mark(cls, id) {
    return '<svg class="mark ' + cls + '"' + (id ? ' id="' + id + '"' : "") + ' viewBox="0 0 32 32" aria-hidden="true">' + MARK + "</svg>";
  }
  function logo() {
    return '<img class="brand__logo" src="' + esc(S.logo) + '" alt="' + esc(S.name) + '" style="height:56px;width:auto;max-width:220px;object-fit:contain;display:block">';
  }

  var SOCIAL_ICON = { facebook: "facebook", instagram: "instagram", x: "x-twitter", twitter: "x-twitter", tiktok: "music", linkedin: "linkedin", youtube: "youtube" };
  function socialLinks() {
    var out = (S.social || []).map(function (p) {
      var icon = SOCIAL_ICON[String(p.platform).toLowerCase()] || "globe";
      return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" aria-label="' + esc(p.platform) + '"><i data-i="' + icon + '"></i></a>';
    }).join("");
    return out ? '<div class="social">' + out + "</div>" : "";
  }

  function links(cls, id, label) {
    return '<nav class="' + cls + '"' + (id ? ' id="' + id + '"' : "") + ' aria-label="' + label + '">' + (S.nav || []).map(function (n) {
      return '<a href="' + esc(n.href) + '"' + (isHere(n.href) ? ' aria-current="page"' : "") + ">" + esc(n.label) + "</a>";
    }).join("") + "</nav>";
  }

  function headerHTML() {
    var brand = S.logo
      ? logo() + '<strong class="nav__name" id="brand-name" style="display:none">' + esc(S.name) + "</strong>"
      : mark("nav__mark", "brand-mark") + '<span class="nav__name"><strong id="brand-name">' + esc(S.name) + "</strong>" + (S.tagline ? "<small>" + esc(S.tagline) + "</small>" : "") + "</span>";
    var reach = (S.phone ? '<a href="' + tel(S.phone) + '">' + esc(S.phone) + "</a>" : "") +
      (S.email ? '<a href="mailto:' + esc(S.email) + '">' + esc(S.email) + "</a>" : "") +
      (S.area ? "<span>Serving " + esc(S.area) + "</span>" : "");
    return '<a class="skip-link" href="#main">Skip to content</a>' +
      '<header class="nav" id="site-header" data-nav>' +
      '<a class="nav__brand" href="index.html" aria-label="' + esc(S.name) + ', home">' + brand + "</a>" +
      links("nav__links", "site-nav", "Primary") +
      '<div class="nav__end">' +
      (S.phone ? '<a class="nav__phone" href="' + tel(S.phone) + '" aria-label="Call ' + esc(S.phone) + '" data-cursor="link"><i data-i="phone"></i><span>' + esc(S.phone) + "</span></a>" : "") +
      (CTA.button ? '<a class="btn btn--small" href="contact.html" data-cursor="link">' + esc(CTA.button) + "</a>" : "") +
      '<button class="nav__toggle" id="nav-toggle" type="button" aria-expanded="false" aria-controls="site-menu" aria-label="Open menu"><i data-i="menu"></i></button>' +
      "</div></header>" +
      '<div class="menu" id="site-menu" role="dialog" aria-modal="true" aria-label="Menu" hidden>' +
      '<div class="menu__top"><a class="nav__brand" href="index.html" aria-label="' + esc(S.name) + ', home">' + (S.logo ? logo() : mark("nav__mark", "") + '<span class="nav__name"><strong>' + esc(S.name) + "</strong></span>") + "</a>" +
      '<button class="menu__close" type="button" data-close aria-label="Close menu"><i data-i="x"></i></button></div>' +
      links("menu__nav", "", "Menu") +
      '<div class="menu__foot">' + reach + socialLinks() + "</div></div>";
  }

  function ctaHTML() {
    if (!CTA.title) return "";
    var picks = (S.services || []).slice(0, 6).map(function (s) {
      return '<a href="contact.html?service=' + encodeURIComponent(s) + '" data-cursor="link">' + esc(s) + "</a>";
    }).join("");
    var reach = (S.phone ? '<li><span>Call</span><a href="' + tel(S.phone) + '">' + esc(S.phone) + "</a></li>" : "") +
      (S.email ? '<li><span>Email</span><a href="mailto:' + esc(S.email) + '">' + esc(S.email) + "</a></li>" : "") +
      (S.area ? "<li><span>Serving</span>" + esc(S.area) + "</li>" : "");
    return '<section class="cta cta--band" data-theme="dark" aria-label="Get a quote">' +
      '<div class="cta__media" aria-hidden="true" data-cta-media>' +
      (CTA.image ? '<img src="' + esc(CTA.image) + '" alt="" loading="lazy" decoding="async" width="1600" height="900"><video muted playsinline loop preload="none" data-bg-video></video>' : "") +
      '</div><div class="cta__inner ui"><div class="cta__copy">' +
      '<p class="eyebrow" data-reveal>' + esc(CTA.button || "Get in touch") + "</p>" +
      "<h2 data-reveal>" + title(CTA.title, CTA.highlight) + "</h2>" +
      (CTA.text ? "<p data-reveal>" + esc(CTA.text) + "</p>" : "") +
      (reach ? '<ul class="cta__contact" data-reveal>' + reach + "</ul>" : "") +
      '</div><div class="form" data-reveal data-stack><div class="form__card" data-light><div class="form__sheen" aria-hidden="true"></div>' +
      '<div class="form__head"><span class="form__kicker">Request a quote</span><h3>Tell us about the job</h3></div>' +
      (picks ? '<div class="form__pills"><p class="form__legend">What do you need?</p>' + picks + "</div>" : "") +
      '<div class="form__foot"><a class="btn btn--accent form__submit" href="contact.html" data-cursor="link">Start my request <i data-i="arrow-right"></i></a>' +
      (S.phone ? '<p class="form__note">Prefer to talk? Call <a href="' + tel(S.phone) + '">' + esc(S.phone) + "</a>.</p>" : "") +
      "</div></div></div></div></section>";
  }

  function footerHTML() {
    var reach = (S.phone ? '<a href="' + tel(S.phone) + '">' + esc(S.phone) + "</a>" : "") +
      (S.email ? '<a href="mailto:' + esc(S.email) + '">' + esc(S.email) + "</a>" : "") +
      (S.area ? "<span>Serving " + esc(S.area) + "</span>" : "");
    return '<footer class="footer site-footer" data-theme="dark"><div class="footer__inner">' +
      '<div class="footer__brand">' + (S.logo ? logo() : mark("footer__mark", "")) +
      '<div><span class="footer__name">' + esc(S.name) + "</span>" + (S.blurb ? "<span>" + esc(S.blurb) + "</span>" : "") + "</div></div>" +
      links("footer__links", "", "Footer") +
      '<div class="footer__contact">' + reach + socialLinks() + "</div></div>" +
      '<div class="footer__base"><span>&copy; <span data-year>' + new Date().getFullYear() + "</span> " + esc(S.name) + "</span>" +
      /* Agency credit: part of the template, keep it. */
      '<span>Designed &amp; developed by <a href="https://socialexpertdigitalllc.com" target="_blank" rel="noopener">Social Expert Digital</a></span>' +
      "</div></footer>" +
      '<div class="mobile-bar" role="region" aria-label="Quick actions">' +
      (S.phone ? '<a class="btn btn--ghost" href="' + tel(S.phone) + '"><i data-i="phone"></i>Call</a>' : "") +
      (CTA.button ? '<a class="btn btn--accent" href="contact.html">' + esc(CTA.button) + "</a>" : "") + "</div>";
  }

  function define(tag, html) {
    if (customElements.get(tag)) return;
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() { this.innerHTML = html(); }
    });
  }
  define("app-header", headerHTML);
  define("app-footer", footerHTML);
  define("app-cta", ctaHTML);
})();
