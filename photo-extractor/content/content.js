// Self-contained content script (classic script, NOT an ES module).
//
// Why inlined: some sites (e.g. Yelp) enforce a strict CSP / Trusted Types that
// blocks a content script's dynamic import() of extension modules. Google Maps
// allows it, Yelp does not — so we avoid imports entirely and inline the
// extraction logic here. The URL/scroll helpers mirror core/url-tools.js and
// core/scroll-state.js (which remain the unit-tested canonical versions).
(() => {
  if (window.__BPE_LOADED__) return;
  window.__BPE_LOADED__ = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- URL helpers (mirror core/url-tools.js) ----
  const G_HOST = /^https?:\/\/[a-z0-9-]+\.googleusercontent\.com\//i;
  const G_TOK = /\/(?:p|gps-cs-s)\/([^=/?#]+)/;
  const G_BG = /url\(["']?(https:[^"')]+googleusercontent[^"')]+)["']?\)/i;
  const isGoogle = (u) => typeof u === 'string' && G_HOST.test(u) && G_TOK.test(u);
  const gId = (u) => { const m = String(u).match(G_TOK); return m ? m[1] : null; };
  const gToOriginal = (u) => { const eq = u.lastIndexOf('='), s = u.lastIndexOf('/'); return eq > s ? u.slice(0, eq + 1) + 's0' : u + '=s0'; };

  const findYelp = (html) => {
    const re = /(?:https?:)?\/\/((?:[a-z0-9-]+\.)*yelpcdn\.com)\/bphoto\/([A-Za-z0-9_-]+)\//g;
    const byId = new Map(); let m;
    while ((m = re.exec(html)) !== null) { const [, host, id] = m; if (!byId.has(id)) byId.set(id, `https://${host}/bphoto/${id}/o.jpg`); }
    return [...byId.entries()].map(([id, url]) => ({ id, url }));
  };

  // ---- scroll stop-condition (mirror core/scroll-state.js) ----
  const makeMonitor = ({ stallLimit = 4, maxIterations = 600 } = {}) => {
    let lastH = -1, lastC = -1, stall = 0, it = 0;
    return (sh, c, atBottom) => {
      it++; const grew = sh > lastH || c > lastC; stall = grew ? 0 : stall + 1;
      lastH = Math.max(lastH, sh); lastC = Math.max(lastC, c);
      if (it >= maxIterations) return true;
      if (stall >= stallLimit && atBottom) return true;
      if (stall >= stallLimit + 2) return true;
      return false;
    };
  };

  // ---- session accumulator (mirror core/harvest.js) ----
  // Google Maps VIRTUALIZES the photo grid: tiles scrolled out of view are
  // unmounted, so a DOM snapshot taken after scrolling holds only what is on
  // screen. That is why a full scroll of a 60-photo gallery used to yield 3-4
  // photos — everything scrolled past was already gone by the time GET_ITEMS
  // read the DOM. Every scroll tick now folds the current snapshot in here,
  // and GET_ITEMS returns the UNION.
  const MAX_WANTED = 30;
  let seen = new Map(); // id -> url, insertion order = page order
  let seenKey = null;

  // One content script survives SPA navigation between businesses, so scope
  // the session: absorbing under a new place must never mix the previous
  // business's photos into this lead's capture.
  const placeKey = () => {
    const m = location.href.match(/\/maps\/place\/([^/@]+)/);
    return m ? decodeURIComponent(m[1]) : location.host + location.pathname;
  };
  const harvest = () => {
    const key = placeKey();
    if (key !== seenKey) { seen = new Map(); seenKey = key; }
    let snapshot;
    try { snapshot = adapter.collect(); } catch { snapshot = new Map(); }
    for (const [id, url] of snapshot) { if (id && url && !seen.has(id)) seen.set(id, url); }
    return seen.size;
  };

  // ---- render/scope helpers (mirror core/collect-filter.js) ----
  // getBoundingClientRect() forces layout; called per-node per scroll tick.
  // If a very large gallery ever makes this feel janky, check el.offsetParent
  // !== null first (no forced layout) as a cheap short-circuit before the
  // rect read.
  const isRendered = (el) => {
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.offsetParent !== null;
    } catch { return false; }
  };

  const bestSrc = (img) => {
    const ss = img.getAttribute('srcset');
    if (ss) {
      const b = ss.split(',').map((s) => s.trim().split(/\s+/)).map(([u, d]) => ({ u, w: parseFloat(d) || 0 })).sort((a, b) => b.w - a.w)[0];
      if (b?.u) return b.u;
    }
    return img.currentSrc || img.src || null;
  };

  // ---- adapters ----
  const googleAdapter = {
    site: 'google-maps',
    match: (u) => /^https:\/\/(www\.google\.[^/]+\/maps\/|maps\.google\.[^/]+\/)/i.test(u),
    async prepare() {
      const open = () => [...document.querySelectorAll('button')].some((b) => /^(Food & drink|By owner|Latest|Vibe)$/.test((b.textContent || '').trim()));
      if (open()) return;
      const entry = [...document.querySelectorAll('button, a')].find((e) => {
        const t = (e.textContent || '').trim();
        return t === 'See photos' || t === 'All photos' || /^See all photos/i.test(t);
      });
      if (entry) { try { entry.click(); await sleep(2000); } catch { /* ignore */ } }
    },
    getScrollContainer() {
      const cnt = (el) => el.querySelectorAll('img[src*="googleusercontent"], [style*="googleusercontent"]').length;
      let best = null;
      for (const el of document.querySelectorAll('div, [role="main"], [role="region"]')) {
        let oy; try { oy = getComputedStyle(el).overflowY; } catch { continue; }
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 150) {
          const c = cnt(el); if (c >= 3 && (!best || c > best.c)) best = { el, c };
        }
      }
      return best ? best.el : (document.scrollingElement || document.documentElement);
    },
    collect() {
      const map = new Map();
      const add = (u) => { if (!isGoogle(u)) return; const id = gId(u); if (id && !map.has(id)) map.set(id, u); };
      // Scope: the scroll container IS the live gallery. Falling back to
      // document keeps a first-run-before-scroll case working, but the
      // isRendered() filter still drops the retained previous place card.
      let root;
      try { root = this.getScrollContainer(); } catch { root = null; }
      if (!root || !root.querySelectorAll) root = document;
      for (const img of root.querySelectorAll('img[src*="googleusercontent"]')) {
        if (isRendered(img)) add(img.currentSrc || img.src);
      }
      for (const el of root.querySelectorAll('[style*="googleusercontent"], [role="img"], button[jsaction*="pane"] div, a[data-photo-index] div')) {
        if (!isRendered(el)) continue;
        const inl = (el.getAttribute && el.getAttribute('style')) || ''; let m = inl.match(G_BG);
        if (!m) { try { m = getComputedStyle(el).backgroundImage.match(G_BG); } catch { m = null; } }
        if (m) add(m[1]);
      }
      return map;
    },
    itemsFrom(map) { return [...map].map(([id, u]) => ({ id, thumbUrl: u, originalUrl: gToOriginal(u), site: 'google-maps' })); },
    items() { return this.itemsFrom(this.collect()); },
  };

  const yelpAdapter = {
    site: 'yelp',
    match: (u) => /^https:\/\/(www\.)?yelp\.com\/(biz|biz_photos)\//i.test(u),
    async prepare() { /* user opens the gallery; nothing to click */ },
    getScrollContainer() { return document.scrollingElement || document.documentElement; },
    collect() { const m = new Map(); for (const { id, url } of findYelp(document.documentElement.outerHTML)) if (!m.has(id)) m.set(id, url); return m; },
    itemsFrom(map) {
      let tab; try { tab = new URL(location.href).searchParams.get('tab') || undefined; } catch { tab = undefined; }
      return [...map].map(([id, u]) => ({ id, thumbUrl: u, originalUrl: u, category: tab, site: 'yelp' }));
    },
    items() { return this.itemsFrom(this.collect()); },
  };

  const genericAdapter = {
    site: 'generic',
    match: () => true,
    async prepare() { /* none */ },
    getScrollContainer() { return document.scrollingElement || document.documentElement; },
    collect() { const m = new Map(); for (const img of document.querySelectorAll('img')) { const u = bestSrc(img); if (u && /^https?:/.test(u) && !m.has(u)) m.set(u, u); } return m; },
    itemsFrom(map) { return [...map].map(([id, u]) => ({ id, thumbUrl: u, originalUrl: u, site: 'generic' })); },
    items() { return this.itemsFrom(this.collect()); },
  };

  const pick = () => {
    for (const a of [googleAdapter, yelpAdapter]) { try { if (a.match(location.href)) return a; } catch { /* ignore */ } }
    return genericAdapter;
  };

  let adapter = pick();
  let stop = false;

  // ---- messaging ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        if (msg?.type === 'PING') { adapter = pick(); return sendResponse({ ok: true, site: adapter.site }); }
        if (msg?.type === 'STOP') { stop = true; return sendResponse({ ok: true }); }
        if (msg?.type === 'GET_ITEMS') {
          harvest(); // fold in whatever is on screen right now
          const items = adapter.itemsFrom(seen);
          return sendResponse({ site: adapter.site, items, health: { ok: items.length > 0, reachedTier: items.length ? 'primary' : 'none', count: items.length } });
        }
        if (msg?.type === 'LOAD_ALL') { stop = false; seen = new Map(); seenKey = placeKey(); await loadAll(); return sendResponse({ ok: true }); }
        sendResponse({ ok: false, error: 'unknown message' });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true; // async sendResponse
  });

  async function loadAll() {
    adapter = pick();
    try { if (adapter.prepare) await adapter.prepare(); } catch { /* best-effort */ }
    for (let i = 0; i < 25 && adapter.collect().size === 0; i++) await sleep(200);
    const c = adapter.getScrollContainer();
    const done = makeMonitor({ stallLimit: 4, maxIterations: 600 });
    for (;;) {
      if (stop) break;
      forceLazy();
      // Accumulated, NOT the DOM count: in a virtualized grid the live count
      // stays flat (or shrinks) while new photos keep streaming past, so the
      // stall detector used to call it "stable" and stop early.
      const count = harvest();
      if (count >= MAX_WANTED) break; // enough for the picker; stop scrolling
      const sh = (c && c.scrollHeight) || document.body.scrollHeight;
      const atBottom = c
        ? (c.scrollTop + c.clientHeight >= c.scrollHeight - 8)
        : (window.innerHeight + window.scrollY >= document.body.scrollHeight - 8);
      safeSend({ type: 'PROGRESS', loaded: count });
      if (done(sh, count, atBottom)) break;
      if (c && c.scrollBy) c.scrollBy(0, c.clientHeight * 0.85); else window.scrollBy(0, window.innerHeight * 0.85);
      await sleep(550);
    }
    safeSend({ type: 'PROGRESS', loaded: harvest(), done: true });
  }

  function forceLazy() {
    for (const img of document.querySelectorAll('img[data-src]')) { try { if (!img.src) img.src = img.dataset.src; } catch { /* ignore */ } }
  }
  function safeSend(m) { try { chrome.runtime.sendMessage(m).catch(() => {}); } catch { /* ignore */ } }
})();
