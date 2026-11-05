/* ==========================================================================
   SD Home — behaviour. Built from site-builder-templates/sdhome-src: edit
   site.js or engine.js there and run `node site-builder-templates/sdhome-src/build.mjs`.

   Two parts:
   1. The builder layer (this part): icons, the phone menu, forms, and the page
      hooks the engine expects. Plain ES2017, no dependencies.
   2. The experience engine (below, minified): the site's own smooth scroll,
      scroll animation and WebGL scenes, started by the builder layer once the
      page is ready. Without WebGL, with reduced motion or if it fails, the page
      stays complete and readable; nothing in the engine can stop part 1.

   RULE FOR THIS FILE: nothing may throw if markup is missing. Pages are
   rewritten per business and elements get removed, so every lookup is guarded
   and each feature runs on its own. Hooks:
     #nav-toggle / #site-menu          the menu on phones and tablets
     [data-hero-media]                 the home hero's fixed background video, filled in here
     [data-gl="depth"] figure > img    a photo with depth parallax (and a clip on hover
                                       while it still shows the template's own photo)
     [data-gl="card"]                  a photo card in the tilting stack ([data-stack])
     [data-gl="wall"] [data-tile]      the drifting gallery wall (data-row 0, 1, 2)
     [data-gl="voices"] [data-voice]   the deck of promise or review cards
     [data-model] + [data-step]        the floor plan that builds itself as the steps pass
     [data-cube-stage] [data-service]  services that roll face to face while scrolling
     [data-count]                      counter; [data-reveal] fades in once
     form[data-sb-form]                posts JSON to its own action; ?service= picks the job
   ========================================================================== */
(function () {
  "use strict";

  var doc = document;
  doc.documentElement.classList.add("js");

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function on(el, type, fn, opts) { if (el) el.addEventListener(type, fn, opts); }
  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function safe(fn) { try { fn(); } catch (e) { if (window.console) console.warn(e); } }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* ------------------------------------------------------------------------
     Icons. <i data-i="name"></i> becomes an inline SVG (24px grid, 2px
     stroke, from the Lucide set — ISC licence). Unknown names fall back to a
     dot, never to a blank gap.
     ------------------------------------------------------------------------ */
  var ICONS = {
  phone: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  "phone-call": '<path d="M13 2a9 9 0 0 1 9 9"/><path d="M13 6a5 5 0 0 1 5 5"/><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
  "map-pin": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  "arrow-up-right": '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "circle-check": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
  hammer: '<path d="m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>',
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  sparkles: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  "message-circle": '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  "calendar-check": '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  "clipboard-list": '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  sprout: '<path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/><path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/>',
  droplets: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  paintbrush: '<path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/>',
  brush: '<path d="m11 10 3 3"/><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z"/><path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"/>',
  ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  "thumbs-up": '<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/>',
  handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
  "hand-heart": '<path d="M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16"/><path d="m14.45 13.39 5.05-4.694C20.196 8 21 6.85 21 5.75a2.75 2.75 0 0 0-4.797-1.837.276.276 0 0 1-.406 0A2.75 2.75 0 0 0 11 5.75c0 1.2.802 2.248 1.5 2.946L16 11.95"/><path d="m2 15 6 6"/><path d="m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a1 1 0 0 0-2.75-2.91"/>',
  heart: '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  menu: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "arrow-down": '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  "chevron-up": '<path d="m18 15-6-6-6 6"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  asterisk: '<path d="M12 6v12"/><path d="M17.196 9 6.804 15"/><path d="m6.804 9 10.392 6"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  cog: '<path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M12 2v2"/><path d="M12 22v-2"/><path d="m17 20.66-1-1.73"/><path d="M11 10.27 7 3.34"/><path d="m20.66 17-1.73-1"/><path d="m3.34 7 1.73 1"/><path d="M14 12h8"/><path d="M2 12h2"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m17 3.34-1 1.73"/><path d="m11 13.73-4 6.93"/>',
  "ticket-percent": '<path d="M2 9a3 3 0 1 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 1 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M9 9h.01"/><path d="m15 9-6 6"/><path d="M15 15h.01"/>',
  headset: '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/>',
  banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  "file-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  construction: '<rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7"/><path d="M7 14v7"/><path d="M17 3v3"/><path d="M7 3v3"/><path d="M10 14 2.3 6.3"/><path d="m14 6 7.7 7.7"/><path d="m8 6 8 8"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  "hard-hat": '<path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M14 6a6 6 0 0 1 6 6v3"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><rect x="2" y="15" width="20" height="4" rx="1"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  snowflake: '<path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="m17 3-3 6 1.5 3"/><path d="M2 12h6.5L10 9"/><path d="m20 10-1.5 2 1.5 2"/><path d="M22 12h-6.5L14 15"/><path d="m4 10 1.5 2L4 14"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/>',
  flame: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
  "building-2": '<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>',
  store: '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
  camera: '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  bug: '<path d="M12 20v-9"/><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/>',
  "trash-2": '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
  facebook: '<path fill="currentColor" stroke="none" d="M13.5 22v-8.2h2.8l.5-3.3h-3.3V8.4c0-.95.4-1.7 1.8-1.7h1.6V3.8c-.3 0-1.3-.15-2.4-.15-2.5 0-4.2 1.5-4.2 4.3v2.55H7.5v3.3h2.8V22z"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/>',
  "x-twitter": '<path fill="currentColor" stroke="none" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78zm-1.08 16.2h1.7L7.4 4.7H5.57z"/>',
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  "arrow-up": '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  "zoom-in": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  award: '<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/>',
  factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/>',
  linkedin: '<path fill="currentColor" stroke="none" d="M6.94 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0M7 8.48H3V21h4zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91z"/>',
  youtube: '<path fill="currentColor" stroke="none" d="M21.58 7.19a2.5 2.5 0 0 0-1.77-1.77C18.25 5 12 5 12 5s-6.25 0-7.81.42a2.5 2.5 0 0 0-1.77 1.77C2 8.75 2 12 2 12s0 3.25.42 4.81a2.5 2.5 0 0 0 1.77 1.77C5.75 19 12 19 12 19s6.25 0 7.81-.42a2.5 2.5 0 0 0 1.77-1.77C22 15.25 22 12 22 12s0-3.25-.42-4.81zM10 15V9l5.2 3z"/>'
  };

  function svg(name) {
    return '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      (ICONS[name] || ICONS.dot) + "</svg>";
  }
  function drawIcons(scope) {
    $$("i[data-i]", scope).forEach(function (el) {
      if (el.getAttribute("data-drawn")) return;
      el.innerHTML = svg(el.getAttribute("data-i") || "");
      el.setAttribute("data-drawn", "1");
      el.setAttribute("aria-hidden", "true");
    });
  }

  /* ------------------------------------------------------------------------
     Fixed media. The home hero plays the same video on every site built from
     this template (there is no video library yet). It is written here, not in
     the page, so a page rewrite can neither change nor drop it.
     A few template photos also have a clip of their own: a slot plays its clip
     only while it still shows that photo, so a swapped photo never plays
     somebody else's kitchen.
     ------------------------------------------------------------------------ */
  var HERO = { poster: "media/hero/hero-poster.webp", loop: "media/hero/hero-loop.mp4" };
  var CLIPS = {
    "media/kitchen/kitchen-island.webp": "media/hero/hero-loop.mp4",
    "media/floors/floor-install.webp": "media/flooring/flooring-loop.mp4",
    "media/living/living-sofa.webp": "media/living/living-loop.mp4"
  };
  function clipFor(img) {
    var src = img && img.getAttribute("src");
    if (!src) return null;
    try {
      var u = new URL(src, location.href);
      if (u.origin !== location.origin) return null;
      for (var key in CLIPS) if (u.pathname === "/" + key || u.pathname.slice(-key.length - 1) === "/" + key) return CLIPS[key];
    } catch (e) { /* not a URL we know */ }
    return null;
  }

  function fillHero() {
    var box = $("[data-hero-media]");
    if (!box) return;
    box.classList.add("hero__media");
    box.setAttribute("aria-hidden", "true");
    box.innerHTML = '<img class="hero__poster" src="' + HERO.poster + '" alt="" width="1600" height="900" fetchpriority="high" decoding="async">' +
      '<video class="hero__video" muted playsinline preload="none" data-loop-mp4="' + HERO.loop + '"></video>' +
      '<div class="hero__plane" data-gl="hero"></div>';
    var v = $("video", box);
    if (v) { v.muted = true; v.defaultMuted = true; }
  }

  function setClips() {
    $$('[data-gl="depth"]').forEach(function (fig) {
      var clip = clipFor($("img", fig));
      if (clip) {
        fig.setAttribute("data-video-mp4", clip);
        fig.setAttribute("data-cursor", "play");
      } else {
        fig.removeAttribute("data-video-mp4");
        if (fig.getAttribute("data-cursor") === "play") fig.removeAttribute("data-cursor");
      }
    });
    $$("[data-cta-media]").forEach(function (box) {
      var video = $("video", box), clip = clipFor($("img", box));
      if (!video) return;
      if (clip) { video.setAttribute("data-mp4", clip); video.muted = true; }
      else video.parentNode.removeChild(video);
    });
  }

  /* The engine draws on one full-page canvas and adds a cursor and a scroll bar. */
  function pageFurniture() {
    var body = doc.body;
    if (!body) return;
    if (!doc.getElementById("gl")) {
      var c = doc.createElement("canvas");
      c.id = "gl";
      c.setAttribute("aria-hidden", "true");
      body.insertBefore(c, body.firstChild);
    }
    if (!$(".cursor")) body.insertAdjacentHTML("afterbegin", '<div class="cursor" aria-hidden="true"><span class="cursor__label"></span></div>');
    if (!$(".progress")) body.insertAdjacentHTML("afterbegin", '<div class="progress" aria-hidden="true"><i></i></div>');
  }

  /* The floor plan drawing (and its fallback without WebGL). */
  var PLAN = '<svg class="plan" viewBox="0 0 600 440" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<g data-plan-step="0"><path d="M40 40H560V400H40Z" stroke-width="3"/></g>' +
    '<g data-plan-step="1"><path d="M280 40V150"/><path d="M280 190V260H560"/><path d="M40 220H110"/><path d="M150 220H180V400"/><path d="M180 320H330"/><path d="M370 320H420"/>' +
    '<path d="M280 150A40 40 0 0 1 320 190" stroke-dasharray="2 4"/><path d="M110 220A40 40 0 0 1 150 180" stroke-dasharray="2 4"/><path d="M330 320A40 40 0 0 1 370 280" stroke-dasharray="2 4"/>' +
    '<path d="M400 40V60M470 40V60"/><path d="M400 60H470" stroke-width="3"/></g>' +
    '<g data-plan-step="2"><path d="M40 24H560"/><path d="M40 18V30M560 18V30M280 18V30"/><path d="M24 40V400"/><path d="M18 40H30M18 400H30M18 220H30"/><path d="M576 260V400"/><path d="M570 260H582M570 400H582"/></g>' +
    '<g data-plan-step="3"><path d="M58 58H262V86H58Z"/><path d="M100 58V86M160 58V86M220 58V86"/><path d="M58 86V200H86V86"/><path d="M118 128H222V176H118Z"/><path d="M136 140H204V164H136Z" stroke-dasharray="3 3"/>' +
    '<path d="M58 246H110V300H58Z"/><path d="M66 254H102V292H66Z"/><path d="M58 320H80V360H58Z"/><path d="M62 360H76V376H62"/><path d="M120 350a16 16 0 1 0 32 0a16 16 0 1 0-32 0"/><path d="M110 330H162V372H110Z"/></g>' +
    '<g data-plan-step="4"><path d="M330 90H520V140H330Z"/><path d="M360 90V140"/><path d="M390 170H470V210H390Z"/><path d="M330 60H360V80H330Z M490 60H520V80H490Z"/><path d="M330 290H440V380H330Z"/><path d="M330 300H440"/><path d="M470 300H540V360H470Z"/><path d="M200 240H260V300H200Z" stroke-dasharray="2 4"/></g></svg>';
  var LEGEND = ["Walls", "Rooms", "Dimensions", "Kitchen & bath", "Furnishing"];
  function drawPlan() {
    var model = $("[data-model]");
    if (!model) return;
    if (!$("svg", model)) model.insertAdjacentHTML("afterbegin", PLAN);
    if (!$("[data-plan-legend]")) {
      model.insertAdjacentHTML("afterend", '<div class="process__legend ui" data-plan-legend aria-hidden="true">' +
        LEGEND.map(function (l, i) { return "<span" + (i ? "" : ' class="is-on"') + ">" + esc(l) + "</span>"; }).join("") + "</div>");
    }
    $$("[data-step]").forEach(function (step, i) { var n = $(".step__num", step); if (n) n.textContent = pad(i + 1); });
  }

  /* Dots and numbers follow however many services or cards the page has. */
  function counts() {
    $$("[data-cube-stage]").forEach(function (stage) {
      var faces = $$("[data-service]", stage);
      faces.forEach(function (f, i) { var n = $(".service__num", f); if (n) n.textContent = pad(i + 1); });
      var dots = $("[data-cube-dots]", stage);
      if (!dots && faces.length > 1) {
        stage.insertAdjacentHTML("beforeend", '<div class="services__dots ui" data-cube-dots></div>');
        dots = $("[data-cube-dots]", stage);
      }
      if (dots) dots.innerHTML = faces.map(function (f, i) {
        var t = $(".service__title, h3", f);
        return '<button type="button"' + (i ? "" : ' class="is-on"') + ' aria-label="' + esc(t ? t.textContent.trim() : "Service " + (i + 1)) + '"></button>';
      }).join("");
    });
    $$("[data-voices]").forEach(function (box) {
      var cards = $$("[data-voice]", box);
      cards.forEach(function (c, i) { if (!c.getAttribute("data-rating")) c.setAttribute("data-mark", pad(i + 1)); });
      var count = $("[data-voices-count]", box), dots = $("[data-voices-dots]", box);
      if (count) count.textContent = "01 / " + pad(cards.length);
      if (dots) dots.innerHTML = cards.map(function (c, i) {
        return '<button type="button"' + (i ? "" : ' class="is-on"') + ' aria-label="Card ' + (i + 1) + '"></button>';
      }).join("");
    });
  }

  /* The header starts light over a dark first section (the engine takes over on scroll). */
  function headerTone() {
    var nav = $("[data-nav]"), first = $("main [data-theme]");
    if (nav && first) nav.classList.toggle("is-light", first.getAttribute("data-theme") === "dark");
  }

  function initMenu() {
    var btn = doc.getElementById("nav-toggle"), panel = doc.getElementById("site-menu");
    if (!btn || !panel) return;
    function lenis() { return window.SDHomeEngine && window.SDHomeEngine.lenis; }
    function set(open, refocus) {
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      panel.hidden = !open;
      doc.body.classList.toggle("menu-open", open);
      var l = lenis();
      if (l) { if (open) l.stop(); else l.start(); }
      if (open) { var first = $("a", panel); if (first) first.focus(); } else if (refocus) btn.focus();
    }
    on(btn, "click", function () { set(btn.getAttribute("aria-expanded") !== "true", true); });
    $$("[data-close]", panel).forEach(function (el) { on(el, "click", function () { set(false, true); }); });
    $$("a", panel).forEach(function (a) { on(a, "click", function () { set(false, false); }); });
    on(doc, "keydown", function (e) {
      if (panel.hidden) return;
      if (e.key === "Escape") set(false, true);
      if (e.key === "Tab") {
        var items = $$("a, button", panel);
        if (!items.length) return;
        var firstEl = items[0], last = items[items.length - 1];
        if (e.shiftKey && doc.activeElement === firstEl) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); firstEl.focus(); }
      }
    });
  }

  /* ------------------------------------------------------------------------
     Forms: <form data-sb-form> posts its fields as JSON to its own action URL
     (a Web3Forms-compatible endpoint) and answers inline. The access key is a
     hidden field in the markup, never written in this file. With no scripting
     the form falls back to a normal POST to the same address.
     ------------------------------------------------------------------------ */
  function initForms() {
    var qs = window.URLSearchParams ? new URLSearchParams(location.search) : null;
    var contact = doc.getElementById("contact-form");
    if (contact && qs && qs.get("service") && contact.elements.service) {
      try { contact.elements.service.value = qs.get("service"); } catch (e) { /* no such choice */ }
    }
    $$("form[data-sb-form]").forEach(function (form) {
      var status = $(".form-status", form);
      var submit = $('[type="submit"]', form);
      var box = form.closest ? form.closest("[data-form-box]") : null;
      function say(text, kind) {
        if (!status) return;
        status.textContent = text;
        status.className = "form-status" + (kind ? " is-" + kind : "");
      }
      function done() {
        var ok = box ? $(".form-success", box) : null;
        if (ok) {
          Array.prototype.slice.call(ok.parentNode.children).forEach(function (c) { if (c !== ok && !c.classList.contains("form__sheen")) c.hidden = true; });
          ok.hidden = false;
        } else say("Thank you, your request is on its way. We will be in touch soon.", "ok");
        form.reset();
      }
      on(form, "submit", function (e) {
        if (!window.fetch || !window.FormData) return;
        e.preventDefault();
        if (form.checkValidity && !form.checkValidity()) { if (form.reportValidity) form.reportValidity(); return; }
        var trap = form.elements ? form.elements.botcheck : null;
        if (trap && trap.checked) { done(); return; } /* a bot ticked the hidden box */
        if (submit) submit.disabled = true;
        say("Sending…", "");
        var data = {};
        new FormData(form).forEach(function (value, key) { data[key] = String(value); });
        fetch(form.action, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(data)
        })
          .then(function (res) { return res.json().catch(function () { return { success: res.ok }; }); })
          .then(function (json) {
            if (json && json.success) done();
            else say((json && json.message) || "Something went wrong. Please try again, or call us.", "err");
          })
          .catch(function () { say("We could not send your request. Please check your connection and try again.", "err"); })
          .then(function () { if (submit) submit.disabled = false; });
      });
    });
  }

  /* The phone quick bar slides in once the first screen has scrolled away. */
  function initQuickBar() {
    if (!$(".mobile-bar")) return;
    var shown = false;
    function check() {
      var show = (window.scrollY || window.pageYOffset || 0) > (window.innerHeight || 800) * 0.5;
      if (show !== shown) { shown = show; doc.body.classList.toggle("show-bar", show); }
    }
    on(window, "scroll", check, { passive: true });
    check();
  }

  function initYear() {
    $$("[data-year]").forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
  }

  /* Everything visible and still when the engine is not running. */
  function staticPage() {
    $$("[data-reveal]").forEach(function (el) { el.classList.add("is-in"); });
    $$("[data-count]").forEach(function (el) { if (el.getAttribute("data-final")) el.textContent = el.getAttribute("data-final"); });
  }

  /* Whatever is on screen at load fades in straight away, as the engine's scroll reveal would. */
  function revealFirstScreen() {
    var h = window.innerHeight || 800, n = 0;
    $$("[data-reveal]").forEach(function (el) {
      if (el.getBoundingClientRect().top > h * 0.9) return;
      setTimeout(function () { el.classList.add("is-in"); }, 120 + n++ * 110);
    });
  }

  /* The LMS previews pages in a sandbox with no origin of its own. There WebGL may draw a photo
     only if it was fetched with CORS, so test once whether the server allows that: if it does,
     the engine loads everything in CORS mode; if not, it runs without WebGL (photos and the hero
     video stay plain elements). A normal site needs no test. */
  function webglMode(done) {
    if (window.origin !== "null") { done({ gl: true, cors: false }); return; }
    var img = new Image(), settled = false;
    function finish(ok) { if (settled) return; settled = true; done({ gl: ok, cors: ok }); }
    img.crossOrigin = "anonymous";
    img.onload = function () { finish(true); };
    img.onerror = function () { finish(false); };
    setTimeout(function () { finish(false); }, 4000);
    img.src = HERO.poster + "?cors-check";
  }

  function canAnimate() {
    return !!(window.SDHomeEngine && window.matchMedia && window.IntersectionObserver && window.requestAnimationFrame && doc.body);
  }

  function boot() {
    safe(drawIcons);
    safe(fillHero);
    safe(setClips);
    safe(drawPlan);
    safe(counts);
    safe(drawIcons);
    safe(headerTone);
    safe(initMenu);
    safe(initForms);
    safe(initYear);
    safe(initQuickBar);
    if (!canAnimate()) { safe(staticPage); return; }
    webglMode(function (mode) {
      try {
        safe(pageFurniture);
        $$("[data-count]").forEach(function (el) { el.setAttribute("data-final", el.textContent); el.textContent = "0"; });
        window.SDHomeEngine.start(mode);
        safe(revealFirstScreen);
      } catch (e) {
        if (window.console) console.warn(e);
        safe(staticPage);
      }
    });
  }

  window.SDHome = { boot: function () { if (doc.body) boot(); else doc.addEventListener("DOMContentLoaded", boot); }, icons: drawIcons, names: function () { return Object.keys(ICONS); } };
})();
