/* ==========================================================================
   Shared components — the header, full-screen menu, closing call-to-action,
   footer and phone quick bar. Every page loads this file and drops in
   <app-header>, <app-cta> and <app-footer>; they are drawn from the data in
   FOUNDRY_SITE below. To change the business, change the DATA. The code under
   "RENDERING" is the template's engine: keep it as it is.

   Text in FOUNDRY_SITE is plain text (write & not &amp;). Leave a value as ""
   (or [] for lists) to leave that element out — the code skips whatever is
   empty, so a business with no email simply has no email anywhere.

   ICONS: <i data-i="name"> is drawn by script.js. Names available:
   phone, phone-call, mail, map-pin, map, navigation, arrow-right,
   arrow-up-right, arrow-down-right, arrow-down, arrow-up, corner-down-right,
   check, circle-check, plus, minus, x, menu, asterisk, chevron-right,
   chevron-left, wrench, hammer, house, shield-check, clock, sparkles,
   message-circle, calendar-check, calendar, clipboard-list, search, settings,
   leaf, sprout, droplets, zap, paintbrush, brush, ruler, truck, car,
   thumbs-up, handshake, hand-heart, heart, users, quote, send, hard-hat, key,
   lock, lightbulb, layers, gauge, sun, snowflake, flame, wind, scissors,
   package, building-2, store, camera, image, target, eye, bug, trash-2,
   globe, link, music, facebook, instagram, x-twitter
   ========================================================================== */

/* ---- SITE THEME ---------------------------------------------------------
   The whole palette. style.css derives every other shade from these three. */
const SITE_THEME = `
:root {
  --brand: #ff5a1f;     /* PRIMARY — colour blocks, markers, buttons, highlights */
  --accent: #ffc83d;    /* ACCENT — the round badge and small highlights */
  --ink-deep: #14110f;  /* DARK — text, footer, dark sections */
}
`;

/* ---- SITE CONTENT -------------------------------------------------------- */
window.FOUNDRY_SITE = {
  name: "Harlow & Reed Property Care",
  tagline: "A local team for repairs, installations and upkeep, with clear communication from the first call.",
  phone: "(555) 010-0148",
  email: "hello@harlowreed.example",
  area: "Eastside and nearby",
  logo: "",      /* a direct image URL; when set it replaces the wordmark */
  profile: "",   /* Google Business Profile link */
  cta: {
    title: "Let's talk about your property",
    text: "Tell us what you need and we will get back to you with a clear next step.",
    button: "Get a quote"
  },
  nav: [
    { label: "Home", href: "index.html" },
    { label: "Services", href: "services.html" },
    { label: "About", href: "about.html" },
    { label: "Work", href: "gallery.html" },
    { label: "Areas", href: "service-areas.html" },
    { label: "Contact", href: "contact.html" }
  ],
  services: [
    "Repairs",
    "Installations",
    "Renovations",
    "Inspections",
    "Urgent call-outs",
    "Seasonal upkeep"
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

  var S = window.FOUNDRY_SITE || {};
  var CTA = S.cta || {};

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function tel(p) { return "tel:" + String(p).replace(/[^\d+]/g, ""); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  var here = (location.pathname.split("/").pop() || "index").replace(/\.html?$/i, "") || "index";
  function isHere(href) { return String(href).replace(/\.html?$/i, "") === here; }

  function brand(inFooter) {
    var id = inFooter ? "" : ' id="brand-name"';
    if (S.logo) {
      var size = inFooter ? "height:64px;width:auto;max-width:280px" : "height:72px;width:auto;max-width:300px";
      return '<img class="brand__logo" src="' + esc(S.logo) + '" alt="' + esc(S.name) + '" style="' + size + ';object-fit:contain;display:block">' +
        '<span class="brand__name"' + id + ' style="display:none">' + esc(S.name) + "</span>";
    }
    return '<span class="brand__mark"' + (inFooter ? "" : ' id="brand-mark"') + ' aria-hidden="true"></span>' +
      '<span class="brand__name"' + id + ">" + esc(S.name) + "</span>";
  }

  var SOCIAL_ICON = { facebook: "facebook", instagram: "instagram", x: "x-twitter", twitter: "x-twitter", tiktok: "music" };
  function socialLinks() {
    var out = (S.social || []).map(function (p) {
      var icon = SOCIAL_ICON[String(p.platform).toLowerCase()] || "globe";
      return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" aria-label="' + esc(p.platform) + '"><i data-i="' + icon + '"></i></a>';
    }).join("");
    if (S.profile) out += '<a href="' + esc(S.profile) + '" target="_blank" rel="noopener" aria-label="Google Business Profile"><i data-i="map-pin"></i></a>';
    return out;
  }

  function headerHTML() {
    var links = (S.nav || []).map(function (n, i) {
      return '<a class="menu__link" style="--i:' + i + '" href="' + esc(n.href) + '"' + (isHere(n.href) ? ' aria-current="page"' : "") + '><span class="label">' + pad(i + 1) + "</span>" + esc(n.label) + "</a>";
    }).join("");
    var reach = "";
    if (S.phone) reach += '<div><span class="label">Call</span><a href="' + tel(S.phone) + '">' + esc(S.phone) + "</a></div>";
    if (S.email) reach += '<div><span class="label">Email</span><a href="mailto:' + esc(S.email) + '">' + esc(S.email) + "</a></div>";
    if (S.area) reach += '<div><span class="label">Serving</span>' + esc(S.area) + "</div>";
    var social = socialLinks();
    if (social) reach += '<div><span class="label">Follow</span><span class="social">' + social + "</span></div>";

    return '<a class="skip" href="#main">Skip to content</a>' +
      '<header class="site-header" id="site-header"><div class="bar">' +
      '<a class="brand" href="index.html" aria-label="' + esc(S.name) + ' home">' + brand(false) + "</a>" +
      (S.area ? '<span class="bar__status label">Serving ' + esc(S.area) + "</span>" : "<span></span>") +
      (S.phone ? '<a class="bar__tel" href="' + tel(S.phone) + '"><span>Call</span>' + esc(S.phone) + "</a>" : "") +
      '<button class="menu-btn" id="nav-toggle" type="button" aria-expanded="false" aria-controls="site-menu">Menu<span class="menu-btn__ico" aria-hidden="true"><i></i><i></i></span></button>' +
      '</div><div class="progress" aria-hidden="true"></div></header>' +
      '<dialog class="menu" id="site-menu" aria-label="Site menu">' +
      '<div class="menu__top"><a class="brand" href="index.html" aria-label="' + esc(S.name) + ' home">' + brand(true) + "</a>" +
      '<button class="menu__close" id="menu-close" type="button">Close<i data-i="x"></i></button></div>' +
      '<nav id="site-nav" aria-label="Primary">' + links + "</nav>" +
      (reach ? '<div class="menu__aside label">' + reach + "</div>" : "<div></div>") + "</dialog>";
  }

  function footerHTML() {
    var navLinks = (S.nav || []).map(function (n) { return '<li><a href="' + esc(n.href) + '">' + esc(n.label) + "</a></li>"; }).join("");
    var svc = (S.services || []).slice(0, 6).map(function (s) { return '<li><a href="services.html">' + esc(s) + "</a></li>"; }).join("");
    var contact = "";
    if (S.phone) contact += '<li><a href="' + tel(S.phone) + '">' + esc(S.phone) + "</a></li>";
    if (S.email) contact += '<li><a href="mailto:' + esc(S.email) + '">' + esc(S.email) + "</a></li>";
    if (S.area) contact += "<li>Serving " + esc(S.area) + "</li>";
    var social = socialLinks();

    return '<footer class="site-footer"><div class="wrap">' +
      '<div class="foot__grid"><div class="foot__brand"><a class="brand" href="index.html" aria-label="' + esc(S.name) + ' home">' + brand(true) + "</a>" +
      (S.tagline ? "<p>" + esc(S.tagline) + "</p>" : "") + "</div>" +
      '<div><h3>Index</h3><ul class="foot__list">' + navLinks + "</ul></div>" +
      (svc ? '<div><h3>Services</h3><ul class="foot__list">' + svc + "</ul></div>" : "<div></div>") +
      '<div><h3>Contact</h3><ul class="foot__list">' + contact + "</ul>" + (social ? '<div class="social">' + social + "</div>" : "") + "</div></div>" +
      '<span class="foot__word" data-fit aria-hidden="true">' + esc(S.name) + "</span>" +
      '<div class="foot__bar label"><span>&copy; <span data-year>2026</span> ' + esc(S.name) + "</span>" +
      (S.area ? "<span>Serving " + esc(S.area) + "</span>" : "") + '<a href="#">Back to top</a></div></div></footer>' +
      '<div class="mobile-bar" role="region" aria-label="Quick actions">' +
      (S.phone ? '<a class="btn btn--ghost" href="' + tel(S.phone) + '">Call</a>' : "") +
      (CTA.button ? '<a class="btn btn--primary" href="contact.html">' + esc(CTA.button) + "</a>" : "") + "</div>";
  }

  function ctaHTML() {
    if (!CTA.title) return "";
    return '<section class="cta" aria-label="Get in touch"><div class="wrap">' +
      '<div class="sec-top"><span class="label">Next step</span><span class="label">Say hello</span></div>' +
      '<h2 data-split>' + esc(CTA.title) + "</h2>" +
      '<div class="cta__row">' + (CTA.text ? '<p class="cta__text">' + esc(CTA.text) + "</p>" : "") +
      '<div class="cta__links">' +
      (S.phone ? '<a class="cta__tel" href="' + tel(S.phone) + '">' + esc(S.phone) + "</a>" : "") +
      (CTA.button ? '<a class="btn btn--light" data-magnetic href="contact.html">' + esc(CTA.button) + '<i data-i="arrow-up-right"></i></a>' : "") +
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
