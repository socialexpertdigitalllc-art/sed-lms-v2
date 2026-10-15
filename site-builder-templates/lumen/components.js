/* ==========================================================================
   Shared components — the top bar, header, footer, quick-action bar and the
   closing call-to-action. Every page loads this file and drops in
   <app-header>, <app-cta> and <app-footer>; they are drawn from the data in
   LUMEN_SITE below. To change the business, change the DATA. The code under
   "RENDERING" is the template's engine: keep it as it is.

   Text in LUMEN_SITE is plain text (write & not &amp;). Leave a value as ""
   (or [] for lists) to leave that element out — the code skips whatever is
   empty, so a business with no email simply has no email anywhere.

   ICONS: <i data-i="name"> is drawn by script.js. Names available:
   phone, phone-call, mail, map-pin, map, navigation, arrow-right,
   arrow-up-right, check, circle-check, wrench, hammer, house, shield-check,
   clock, sparkles, message-circle, calendar-check, calendar, clipboard-list,
   search, settings, leaf, sprout, droplets, zap, paintbrush, brush, ruler,
   truck, car, thumbs-up, handshake, hand-heart, heart, users, quote, plus, x,
   menu, chevron-right, chevron-left, send, hard-hat, key, lock, lightbulb,
   layers, gauge, sun, snowflake, flame, wind, scissors, package, building-2,
   store, camera, image, target, eye, bug, trash-2, globe, link, music,
   facebook, instagram, x-twitter
   ========================================================================== */

/* ---- SITE THEME ---------------------------------------------------------
   The whole palette. style.css derives every other shade from these three. */
const SITE_THEME = `
:root {
  --brand: #0f766e;     /* PRIMARY — buttons, links, icons, highlights */
  --accent: #f59e0b;    /* ACCENT — badges, call-to-action details */
  --ink-deep: #0b1d26;  /* DARK — top bar, footer, dark sections, headings */
}
`;

/* ---- SITE CONTENT -------------------------------------------------------- */
window.LUMEN_SITE = {
  name: "Ridgeline Home Services",
  tagline: "A local team for repairs, installations and upgrades, with clear communication from the first call.",
  phone: "(555) 010-0123",
  email: "hello@ridgelinehome.example",
  area: "Lakeside and nearby",
  logo: "",      /* a direct image URL; when set it replaces the wordmark */
  profile: "",   /* Google Business Profile link */
  cta: {
    title: "Ready to talk about your project?",
    text: "Tell us what you need and we will get back to you with a clear next step.",
    button: "Get a quote"
  },
  nav: [
    { label: "Home", href: "index.html" },
    { label: "Services", href: "services.html" },
    { label: "About", href: "about.html" },
    { label: "Gallery", href: "gallery.html" },
    { label: "Service Areas", href: "service-areas.html" },
    { label: "Contact", href: "contact.html" }
  ],
  services: [
    "Repairs & maintenance",
    "New installations",
    "Upgrades & remodels",
    "Inspections & assessments",
    "Emergency call-outs",
    "Seasonal care"
  ],
  social: [
    { platform: "Facebook", url: "https://www.facebook.com/" },
    { platform: "Instagram", url: "https://www.instagram.com/" }
  ]
};

/* ==== RENDERING ========================================================== */
(function () {
  "use strict";

  /* Inject the theme first, at the end of <head>, so the colours are in place
     before anything is painted. */
  var themeTag = document.createElement("style");
  themeTag.id = "site-theme";
  themeTag.textContent = SITE_THEME;
  document.head.appendChild(themeTag);
  document.documentElement.classList.add("js");

  var S = window.LUMEN_SITE || {};
  var CTA = S.cta || {};

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function tel(p) { return "tel:" + String(p).replace(/[^\d+]/g, ""); }

  var here = (location.pathname.split("/").pop() || "index").replace(/\.html?$/i, "") || "index";
  function isHere(href) { return String(href).replace(/\.html?$/i, "") === here; }

  function brand(inFooter) {
    if (S.logo) {
      var size = inFooter ? "height:64px;width:auto;max-width:280px" : "height:72px;width:auto;max-width:300px";
      return '<img class="brand__logo" src="' + esc(S.logo) + '" alt="' + esc(S.name) + '" style="' + size + ';object-fit:contain;display:block">' +
        '<span class="brand__name"' + (inFooter ? "" : ' id="brand-name"') + ' style="display:none">' + esc(S.name) + "</span>";
    }
    return '<span class="brand__mark"' + (inFooter ? "" : ' id="brand-mark"') + ' aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 21 12 12 21 3 12Z"/><path d="m12 8 4 4-4 4-4-4Z"/></svg></span>' +
      '<span class="brand__name"' + (inFooter ? "" : ' id="brand-name"') + ">" + esc(S.name) + "</span>";
  }

  function topbar() {
    var bits = [];
    if (S.area) bits.push('<span class="topbar__item"><i data-i="map-pin"></i>Serving ' + esc(S.area) + "</span>");
    if (S.phone) bits.push('<a class="topbar__item topbar__spacer" href="' + tel(S.phone) + '"><i data-i="phone"></i>' + esc(S.phone) + "</a>");
    if (S.email) bits.push('<a class="topbar__item" href="mailto:' + esc(S.email) + '"><i data-i="mail"></i>' + esc(S.email) + "</a>");
    return bits.length ? '<div class="topbar"><div class="container topbar__in">' + bits.join("") + "</div></div>" : "";
  }

  function headerHTML() {
    var links = (S.nav || []).map(function (n) {
      return '<a href="' + esc(n.href) + '"' + (isHere(n.href) ? ' aria-current="page"' : "") + ">" + esc(n.label) + "</a>";
    }).join("");
    return '<a class="skip" href="#main">Skip to content</a>' + topbar() +
      '<header class="site-header" id="site-header"><div class="container header__in">' +
      '<a class="brand" href="index.html" aria-label="' + esc(S.name) + ' home">' + brand(false) + "</a>" +
      '<nav class="nav" id="site-nav" aria-label="Primary">' + links + "</nav>" +
      '<div class="header__cta">' +
      (CTA.button ? '<a class="btn btn--primary" href="contact.html">' + esc(CTA.button) + '<i data-i="arrow-right"></i></a>' : "") +
      '<button class="nav-toggle" id="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Open menu"><span></span><span></span></button>' +
      "</div></div></header>";
  }

  var SOCIAL_ICON = { facebook: "facebook", instagram: "instagram", x: "x-twitter", twitter: "x-twitter", tiktok: "music" };

  function footerHTML() {
    var navLinks = (S.nav || []).map(function (n) { return '<li><a href="' + esc(n.href) + '">' + esc(n.label) + "</a></li>"; }).join("");
    var svc = (S.services || []).slice(0, 6).map(function (s) { return '<li><a href="services.html">' + esc(s) + "</a></li>"; }).join("");

    var social = (S.social || []).map(function (p) {
      var icon = SOCIAL_ICON[String(p.platform).toLowerCase()] || "globe";
      return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" aria-label="' + esc(p.platform) + '"><i data-i="' + icon + '"></i></a>';
    }).join("");
    if (S.profile) social += '<a href="' + esc(S.profile) + '" target="_blank" rel="noopener" aria-label="Google Business Profile"><i data-i="map-pin"></i></a>';

    var contact = "";
    if (S.phone) contact += '<li><i data-i="phone"></i><a href="' + tel(S.phone) + '">' + esc(S.phone) + "</a></li>";
    if (S.email) contact += '<li><i data-i="mail"></i><a href="mailto:' + esc(S.email) + '">' + esc(S.email) + "</a></li>";
    if (S.area) contact += '<li><i data-i="map-pin"></i><span>Serving ' + esc(S.area) + "</span></li>";

    return '<footer class="site-footer"><div class="container footer__grid">' +
      '<div class="footer__brand"><a class="brand" href="index.html" aria-label="' + esc(S.name) + ' home">' + brand(true) + "</a>" +
      (S.tagline ? "<p>" + esc(S.tagline) + "</p>" : "") +
      (social ? '<div class="social">' + social + "</div>" : "") + "</div>" +
      '<div><h3>Explore</h3><ul class="footer__list">' + navLinks + "</ul></div>" +
      (svc ? '<div><h3>Services</h3><ul class="footer__list">' + svc + "</ul></div>" : "<div></div>") +
      '<div><h3>Get in touch</h3><ul class="footer__list">' + contact + "</ul></div>" +
      '</div><div class="container footer__bar"><span>&copy; <span data-year>2026</span> ' + esc(S.name) + ". All rights reserved.</span>" +
      (S.area ? "<span>Serving " + esc(S.area) + "</span>" : "") + "</div></footer>" +
      '<div class="mobile-bar" role="region" aria-label="Quick actions">' +
      (S.phone ? '<a class="btn btn--ghost" href="' + tel(S.phone) + '"><i data-i="phone"></i>Call</a>' : "") +
      (CTA.button ? '<a class="btn btn--primary" href="contact.html">' + esc(CTA.button) + "</a>" : "") + "</div>";
  }

  function ctaHTML() {
    if (!CTA.title) return "";
    return '<section class="cta" aria-label="Get in touch"><div class="container"><div class="cta-card reveal">' +
      '<div class="cta-card__copy"><h2>' + esc(CTA.title) + "</h2>" + (CTA.text ? "<p>" + esc(CTA.text) + "</p>" : "") + "</div>" +
      '<div class="actions">' +
      (CTA.button ? '<a class="btn btn--light btn--lg" href="contact.html">' + esc(CTA.button) + '<i data-i="arrow-right"></i></a>' : "") +
      (S.phone ? '<a class="btn btn--outline-light btn--lg" href="' + tel(S.phone) + '"><i data-i="phone"></i>' + esc(S.phone) + "</a>" : "") +
      "</div></div></div></section>";
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
