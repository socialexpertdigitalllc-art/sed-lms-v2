// lib/site-builder/contrastGuard.ts
/**
 * The contrast guard: a small script every Site Builder page ships with, which
 * keeps text readable on whatever it sits on.
 *
 * Why it exists (2026-10-14): a palette is only half the problem. Templates
 * hard-code text colours that assume their own palette — white button text on
 * an accent that was a mid-dark orange, dark headings on a section that was
 * light — so a client colour that is lighter or darker than the template's
 * made text vanish ("light button, light text, and vice versa — not only
 * buttons"). The AI was told to watch for it and often didn't. This fixes it
 * deterministically, in the visitor's browser, for any template.
 *
 * What it does, per element that holds text (and per form field):
 *  - works out the colour actually behind the text by walking up the page
 *    (backgrounds, gradients, overlays), and leaves the text alone whenever it
 *    can't be sure — text over a photo or video, or inside something floating
 *    over the page (a transparent header over the hero);
 *  - only acts on text that is clearly hard to read (under 3:1, or 2.3:1 for
 *    large text) and then makes it properly readable (4.5:1 / 3:1), moving the
 *    text colour's lightness toward black or white — same hue, smallest change;
 *  - judges colours once they have settled: text whose colour or background
 *    is still animating (a template fading into the site's theme at load) is
 *    checked when the animation ends;
 *  - re-checks content that appears or changes later (menus, rotating text,
 *    a header that changes colour on scroll), restoring its own changes first,
 *    and re-checks what it fixed on hover and focus, when a button's
 *    background changes under the colour it was given.
 *
 * Plain ES5 (bar one Unicode regex) with no template syntax, so it can sit
 * inline in any page.
 */

export const CONTRAST_GUARD_ID = "sb-contrast-guard";

export const CONTRAST_GUARD_JS = String.raw`(function () {
  "use strict";
  if (window.sbContrastGuard) return;
  var ATTR = "data-sb-ink";
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, OPTION: 1, HEAD: 1, TITLE: 1 };
  var cache = {};
  var px = null;

  function parse(str) {
    if (!str) return null;
    if (cache.hasOwnProperty(str)) return cache[str];
    var m, out = null;
    if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,\/]\s*([\d.]+)(%?))?\s*\)$/i.exec(str))) {
      out = [+m[1], +m[2], +m[3], m[4] == null ? 1 : (m[5] ? m[4] / 100 : +m[4])];
    } else if ((m = /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/i.exec(str))) {
      out = [m[1] * 255, m[2] * 255, m[3] * 255, m[4] == null ? 1 : (m[5] ? m[4] / 100 : +m[4])];
    } else if (str === "transparent") {
      out = [0, 0, 0, 0];
    } else {
      try {
        if (!px) { var cv = document.createElement("canvas"); cv.width = cv.height = 1; px = cv.getContext("2d", { willReadFrequently: true }); }
        px.clearRect(0, 0, 1, 1); px.fillStyle = "#000"; px.fillStyle = str; px.fillRect(0, 0, 1, 1);
        var d = px.getImageData(0, 0, 1, 1).data;
        out = [d[0], d[1], d[2], d[3] / 255];
      } catch (e) { out = null; }
    }
    cache[str] = out;
    return out;
  }

  // The average colour of a gradient (the part before any url()).
  function gradient(img) {
    if (!img || img === "none") return null;
    var cut = img.indexOf("url(");
    var part = cut < 0 ? img : img.slice(0, cut);
    var toks = part.match(/rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b/gi);
    if (!toks) return null;
    var s = [0, 0, 0, 0], n = 0;
    for (var i = 0; i < toks.length; i++) {
      var c = parse(toks[i]);
      if (c) { s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3] += c[3]; n++; }
    }
    return n ? [s[0] / n, s[1] / n, s[2] / n, s[3] / n] : null;
  }

  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function ratio(a, b) { var x = lum(a), y = lum(b); return x > y ? (x + 0.05) / (y + 0.05) : (y + 0.05) / (x + 0.05); }
  function over(top, under) {
    var a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  }
  // layers are listed top first.
  function flatten(layers, base) {
    var c = base;
    for (var i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    return c;
  }

  // An absolutely positioned ::before/::after covering the element — the
  // usual dark overlay on a photo section.
  function overlayOf(el) {
    var best = null, r = el.getBoundingClientRect(), area = r.width * r.height;
    ["::before", "::after"].forEach(function (p) {
      var ps = getComputedStyle(el, p);
      if (!ps || ps.content === "none" || ps.display === "none") return;
      if (ps.position !== "absolute" && ps.position !== "fixed") return;
      var w = parseFloat(ps.width), h = parseFloat(ps.height);
      if (!(w * h >= area * 0.6)) return;
      var c = parse(ps.backgroundColor), g = gradient(ps.backgroundImage);
      var col = c && c[3] > 0.02 ? c : g;
      if (!col) return;
      var op = parseFloat(ps.opacity);
      if (!isNaN(op)) col = [col[0], col[1], col[2], col[3] * op];
      if (!best || col[3] > best[3]) best = col;
    });
    return best;
  }

  // Large images, videos and background-image boxes: text over one of these
  // (that isn't covered by something solid first) has an unknowable backdrop.
  function mediaList() {
    var out = [], els = document.body.getElementsByTagName("*");
    for (var i = 0; i < els.length; i++) {
      var m = els[i], tag = m.tagName;
      if (!(tag === "IMG" || tag === "VIDEO" || tag === "CANVAS" || tag === "IFRAME" || tag === "PICTURE")) {
        var bi = getComputedStyle(m).backgroundImage;
        if (!bi || bi.indexOf("url(") < 0) continue;
      }
      var r = m.getBoundingClientRect();
      if (r.width * r.height < 12000) continue;
      out.push({ el: m, l: r.left + window.scrollX, t: r.top + window.scrollY, r: r.right + window.scrollX, b: r.bottom + window.scrollY });
    }
    return out;
  }

  // A colour or background animation still running on node — a transition
  // into the site's theme at load, a hover fade. Reading colours mid-way gives
  // neither the old nor the new look, so such text is judged once it ends.
  // Endless animations are judged as they are: there is no "after".
  function moving(node) {
    if (!node.getAnimations) return null;
    var list;
    try { list = node.getAnimations(); } catch (e) { return null; }
    for (var i = 0; i < list.length; i++) {
      var a = list[i], eff = a.effect;
      if (a.playState !== "running" || !eff || !eff.getKeyframes) continue;
      if (eff.getTiming && eff.getTiming().iterations === Infinity) continue;
      var kf = eff.getKeyframes();
      for (var k = 0; k < kf.length; k++) for (var prop in kf[k]) if (/color|background/i.test(prop)) return a;
    }
    return null;
  }
  var busy = null;
  function defer(el, anim) {
    if (!anim || !anim.finished || !anim.finished.then) return;
    var again = function () { schedule(el); };
    anim.finished.then(again, again);
  }

  // What one element contributes behind the text inside it — cached per pass,
  // since every text element walks the same ancestors.
  var infos = null;
  function info(node) {
    var hit = infos && infos.get(node);
    if (hit) return hit;
    var cs = getComputedStyle(node), bi = cs.backgroundImage;
    hit = {
      overlay: overlayOf(node),
      gradient: bi && bi !== "none" ? gradient(bi) : null,
      photo: !!bi && bi.indexOf("url(") >= 0,
      color: parse(cs.backgroundColor),
      floats: cs.position === "absolute" || cs.position === "fixed" || cs.position === "sticky",
      moving: moving(node)
    };
    if (infos) infos.set(node, hit);
    return hit;
  }

  // The colour behind el's text at point p, or null when it can't be known,
  // or false while it is still animating (see moving()). When a photo is
  // involved, returns the two extremes the photo could give.
  function backdrop(el, p, media) {
    var layers = [], stopAt = null, photo = null;
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var f = info(node);
      if (f.moving) { busy = f.moving; return false; }
      if (f.overlay) layers.push(f.overlay);
      if (f.gradient) layers.push(f.gradient);
      if (f.photo) { photo = node; break; }
      if (f.gradient && f.gradient[3] >= 0.98) { stopAt = node; break; }
      if (f.color && f.color[3] > 0.02) {
        layers.push(f.color);
        if (f.color[3] >= 0.98) { stopAt = node; break; }
      }
      if (f.floats) return null;
    }
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      if (m.el === el || m.el === photo || m.el.contains(el)) continue;
      if (stopAt && (!stopAt.contains(m.el) || stopAt === m.el)) continue;
      if (p.x >= m.l && p.x <= m.r && p.y >= m.t && p.y <= m.b) return null;
    }
    if (photo) return [flatten(layers, [30, 30, 30, 1]), flatten(layers, [225, 225, 225, 1])];
    return [flatten(layers, [255, 255, 255, 1])];
  }

  // fg moved toward black or white until it reaches target on bg. A small move
  // keeps the colour recognisably itself (a deeper brand orange); when it
  // would take a big one, plain near-black or white reads cleaner than a
  // washed-out tint (pink nav links from a red brand). Icons may tint further.
  function fix(fg, bg, target, icon) {
    var toDark = ratio([0, 0, 0, 1], bg) >= ratio([255, 255, 255, 1], bg);
    var end = toDark ? [17, 17, 17] : [255, 255, 255];
    for (var t = 0.1; t < 1.0001; t += 0.1) {
      if (!icon && t > 0.45) break;
      var c = [fg[0] + (end[0] - fg[0]) * t, fg[1] + (end[1] - fg[1]) * t, fg[2] + (end[2] - fg[2]) * t, 1];
      if (ratio(c, bg) >= target) return c;
    }
    return [end[0], end[1], end[2], 1];
  }

  // Everything the guard has ever fixed: its hover and focus states are
  // re-checked too (see start()).
  var touched = typeof WeakSet === "function" ? new WeakSet() : null;

  function apply(el, c) {
    if (touched) touched.add(el);
    if (!el.hasAttribute(ATTR)) {
      el.setAttribute(ATTR, el.style.getPropertyValue("color") + "|" + el.style.getPropertyPriority("color"));
    }
    el.style.setProperty("color", "rgb(" + Math.round(c[0]) + ", " + Math.round(c[1]) + ", " + Math.round(c[2]) + ")", "important");
  }

  function restore(el) {
    var saved = (el.getAttribute(ATTR) || "|").split("|");
    el.removeAttribute(ATTR);
    if (saved[0]) el.style.setProperty("color", saved[0], saved[1] || "");
    else el.style.removeProperty("color");
  }

  function pointOf(el, text) {
    var r = null;
    if (text) {
      var range = document.createRange();
      range.selectNodeContents(text);
      var rects = range.getClientRects();
      if (rects.length) r = rects[0];
    }
    if (!r) r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    return { x: r.left + r.width / 2 + window.scrollX, y: r.top + r.height / 2 + window.scrollY };
  }

  function check(el, text, media) {
    if (el.closest && el.closest("[aria-hidden=true]")) return;
    var cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || (cs.mixBlendMode && cs.mixBlendMode !== "normal")) return;
    var fill = cs.webkitTextFillColor;
    var fg = parse(fill && fill !== cs.color ? fill : cs.color);
    if (!fg || fg[3] < 0.35) return;
    var p = pointOf(el, text);
    if (!p) return;
    var bgs = backdrop(el, p, media);
    if (bgs === false) { defer(el, busy); return; }
    if (!bgs) return;
    var size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    var large = size >= 24 || (size >= 18.66 && bold);
    var trigger = large ? 2.3 : 3, target = large ? 3 : 4.5;
    var words = text ? text.nodeValue.trim() : "";
    // Stars, arrows, ticks: icons, not text — conventions like gold stars stay
    // as designed, and only a nearly invisible one (white on white) is fixed.
    var icon = !!text && !/[\p{L}\p{N}]/u.test(words);
    if (icon) { trigger = 1.4; target = 3; }
    var worst = Infinity, worstBg = null, best = 0;
    for (var i = 0; i < bgs.length; i++) {
      var eff = fg[3] < 1 ? over(fg, bgs[i]) : fg;
      var r = ratio(eff, bgs[i]);
      if (r < worst) { worst = r; worstBg = bgs[i]; }
      if (r > best) best = r;
    }
    // Over a photo: act only when the text fails whatever the photo looks like.
    if (bgs.length > 1 && best >= trigger) return;
    if (worst >= trigger) return;
    // A huge, faint "01" is a watermark by design, not a readability bug.
    if (size >= 40 && words.length <= 3 && worst < 1.6) return;
    var mid = bgs.length > 1 ? flatten([[bgs[0][0], bgs[0][1], bgs[0][2], 0.5]], bgs[1]) : worstBg;
    apply(el, fix(fg[3] < 1 ? over(fg, mid) : fg, mid, target, icon));
  }

  function pass(root) {
    if (!root || !document.body || !document.body.contains(root)) return;
    // Its own earlier fixes are undone first and the text judged afresh — with
    // their transitions paused, so the colour read is the real one (not the
    // first frame of a fade back) and a still-needed fix never flickers.
    var marked = root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll("[" + ATTR + "]")) : [];
    if (root.hasAttribute && root.hasAttribute(ATTR)) marked.push(root);
    var paused = [];
    for (var i = 0; i < marked.length; i++) {
      var m = marked[i];
      paused.push([m, m.style.getPropertyValue("transition"), m.style.getPropertyPriority("transition")]);
      m.style.setProperty("transition", "none", "important");
      restore(m);
    }
    infos = typeof Map === "function" ? new Map() : null;
    var media = mediaList();
    var seen = [], seenSet = typeof Set === "function" ? new Set() : null;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    for (var t = walker.nextNode(); t; t = walker.nextNode()) {
      var el = t.parentElement;
      if (!el || SKIP[el.tagName] || !/\S/.test(t.nodeValue)) continue;
      if (seenSet ? seenSet.has(el) : seen.indexOf(el) >= 0) continue;
      if (seenSet) seenSet.add(el); else seen.push(el);
      if (!el.getClientRects().length) continue;
      check(el, t, media);
    }
    var FIELDS = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=image]), textarea, select";
    var fields = root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(FIELDS)) : [];
    if (root.matches && root.matches(FIELDS)) fields.push(root);
    for (var j = 0; j < fields.length; j++) if (fields[j].getClientRects().length) check(fields[j], null, media);
    for (var q = 0; q < paused.length; q++) {
      var pz = paused[q];
      void getComputedStyle(pz[0]).color;
      if (pz[1]) pz[0].style.setProperty("transition", pz[1], pz[2]);
      else pz[0].style.removeProperty("transition");
    }
    infos = null;
  }

  var timer = null, pending = [], slow = false;
  function flush() {
    timer = null;
    var roots = pending;
    pending = [];
    var started = Date.now();
    if (roots.indexOf(document.body) >= 0 || roots.length > 25) pass(document.body);
    else for (var i = 0; i < roots.length; i++) pass(roots[i]);
    if (Date.now() - started > 400) slow = true;
  }
  function schedule(node) {
    if (!node) return;
    if (node.nodeType !== 1) node = node.parentElement;
    if (!node || pending.indexOf(node) >= 0) return;
    pending.push(node);
    if (!timer) timer = setTimeout(flush, 120);
  }

  // A fixed colour was chosen for the element at rest; a hover or focus style
  // that changes the background (a light button turning dark) is re-checked
  // once its transition has run, and again when the pointer or focus leaves.
  var interacted = [], interactTimer = null;
  function wasTouched(el) {
    if (!touched) return false;
    if (touched.has(el)) return true;
    var kids = el.getElementsByTagName("*");
    for (var i = 0; i < kids.length && i < 60; i++) if (touched.has(kids[i])) return true;
    return false;
  }
  function interact(e) {
    var t = e.target;
    if (slow || !t || t.nodeType !== 1 || !t.closest) return;
    var el = t.closest("a, button, [role=button], summary, label, input, select, textarea");
    if (!el || !wasTouched(el)) return;
    if (interacted.indexOf(el) < 0) interacted.push(el);
    clearTimeout(interactTimer);
    interactTimer = setTimeout(function () {
      var els = interacted;
      interacted = [];
      for (var i = 0; i < els.length; i++) pass(els[i]);
    }, 350);
  }

  function start() {
    schedule(document.body);
    window.addEventListener("load", function () {
      schedule(document.body);
      setTimeout(function () { schedule(document.body); }, 1500);
    });
    ["mouseover", "mouseout", "focusin", "focusout"].forEach(function (type) {
      document.addEventListener(type, interact, true);
    });
    var resized = null;
    window.addEventListener("resize", function () {
      clearTimeout(resized);
      resized = setTimeout(function () { schedule(document.body); }, 300);
    });
    if (typeof MutationObserver !== "function") return;
    new MutationObserver(function (list) {
      if (slow) return;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === "attributes") schedule(m.target);
        else for (var k = 0; k < m.addedNodes.length; k++) schedule(m.addedNodes[k]);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: false, attributes: true, attributeFilter: ["class"] });
  }

  window.sbContrastGuard = { recheck: function () { schedule(document.body); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();`;

/** The inline tag every generated page carries, just before </body>. */
export function contrastGuardTag(): string {
  return `<script id="${CONTRAST_GUARD_ID}">\n/* SED Site Builder: keeps every text readable on whatever it sits on. Leave in place. */\n${CONTRAST_GUARD_JS}\n</script>`;
}
