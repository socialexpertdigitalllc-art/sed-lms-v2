import { runPool, withRetry } from '../core/concurrency.js';
import { buildZipBlob } from '../core/zip.js';
import { downloadUrl, downloadBlob } from '../core/download.js';
import { buildFilename, sanitizeSegment } from '../core/naming.js';
import { toGoogleSize } from '../core/url-tools.js';
import { uploadByUrl, uploadByBase64, isBadKeyError } from '../core/imgbb.js';

const el = (id) => document.getElementById(id);
const state = {
  tabId: null, site: null, items: [], selected: new Set(),
  activeCategory: null, abort: null, businessName: 'business',
  profiles: [], activeId: null,
};

const SVG = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg>',
};
const SITE_LABEL = { 'google-maps': 'Google Maps', yelp: 'Yelp', generic: 'this page' };

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  state.businessName = guessBusinessName(tab?.title);
  const ping = await send({ type: 'PING' }).catch(() => null);
  if (!ping?.ok || ping.site === 'generic') {
    setStatus('No supported business page', false);
    return;
  }
  state.site = ping.site;
  el('empty').hidden = true;
  setStatus(`${SITE_LABEL[ping.site] || ping.site} connected`, true);
  el('toolbar').hidden = false;
  wireToolbar();
}

function setStatus(text, live) {
  el('statusText').textContent = text;
  el('status').classList.toggle('live', !!live);
}

function wireToolbar() {
  el('loadBtn').addEventListener('click', onLoadAll);
  el('stopBtn').addEventListener('click', () => send({ type: 'STOP' }).catch(() => {}));
  el('selAll').addEventListener('click', () => { visibleItems().forEach((p) => state.selected.add(p.id)); refreshSelection(); updateSelUI(); });
  el('selNone').addEventListener('click', () => { state.selected.clear(); refreshSelection(); updateSelUI(); });
  el('downloadBtn').addEventListener('click', onDownload);

  loadProfiles();
  el('keySelect').addEventListener('change', onSelectProfile);
  el('saveKey').addEventListener('click', onSaveProfile);
  el('delKey').addEventListener('click', onDeleteProfile);
  el('toggleKey').addEventListener('click', () => {
    const f = el('imgbbKey'); f.type = f.type === 'password' ? 'text' : 'password';
  });
  el('uploadBtn').addEventListener('click', onUpload);
}

// --- imgbb accounts (named, multiple) ---
function uid() {
  try { return crypto.randomUUID(); } catch { return 'k' + Date.now() + Math.random().toString(16).slice(2); }
}
function activeProfile() { return state.profiles.find((p) => p.id === state.activeId) || null; }
function activeKey() { return activeProfile()?.key || ''; }

async function loadProfiles() {
  const { imgbbProfiles, imgbbSelectedId, imgbbKey } = await chrome.storage.local.get(['imgbbProfiles', 'imgbbSelectedId', 'imgbbKey']);
  let profiles = Array.isArray(imgbbProfiles) ? imgbbProfiles : [];
  if (!profiles.length && typeof imgbbKey === 'string' && imgbbKey.trim()) {
    profiles = [{ id: uid(), name: 'Default', key: imgbbKey.trim() }]; // migrate legacy single key
    await chrome.storage.local.set({ imgbbProfiles: profiles });
    await chrome.storage.local.remove('imgbbKey');
  }
  state.profiles = profiles;
  state.activeId = (imgbbSelectedId && profiles.some((p) => p.id === imgbbSelectedId)) ? imgbbSelectedId : (profiles[0]?.id || null);
  renderProfiles();
}

function renderProfiles() {
  const sel = el('keySelect');
  sel.innerHTML = '';
  for (const p of state.profiles) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  }
  const add = document.createElement('option');
  add.value = '__add';
  add.textContent = state.profiles.length ? '+ Add account…' : '+ Add your first account…';
  sel.appendChild(add);

  if (state.activeId) {
    sel.value = state.activeId;
    el('keyForm').hidden = true;
    el('delKey').disabled = false;
    el('keyState').textContent = `using “${activeProfile().name}”`;
  } else {
    sel.value = '__add';
    el('keyForm').hidden = false;
    el('delKey').disabled = true;
    el('keyState').textContent = '';
  }
}

async function onSelectProfile(e) {
  if (e.target.value === '__add') {
    state.activeId = null;
    el('keyForm').hidden = false;
    el('keyName').value = ''; el('imgbbKey').value = '';
    el('delKey').disabled = true;
    el('keyState').textContent = '';
    el('keyName').focus();
  } else {
    state.activeId = e.target.value;
    await chrome.storage.local.set({ imgbbSelectedId: state.activeId });
    el('keyForm').hidden = true;
    el('delKey').disabled = false;
    el('keyState').textContent = `using “${activeProfile().name}”`;
  }
}

async function onSaveProfile() {
  const key = el('imgbbKey').value.trim();
  const name = el('keyName').value.trim() || 'Account';
  if (!key) { el('keyState').textContent = 'Enter the API key.'; return; }
  const prof = { id: uid(), name, key };
  state.profiles.push(prof);
  state.activeId = prof.id;
  await chrome.storage.local.set({ imgbbProfiles: state.profiles, imgbbSelectedId: state.activeId });
  el('keyName').value = ''; el('imgbbKey').value = '';
  renderProfiles();
  el('keyState').textContent = `saved “${name}”`;
}

async function onDeleteProfile() {
  const p = activeProfile();
  if (!p) return;
  state.profiles = state.profiles.filter((x) => x.id !== p.id);
  state.activeId = state.profiles[0]?.id || null;
  await chrome.storage.local.set({ imgbbProfiles: state.profiles, imgbbSelectedId: state.activeId });
  renderProfiles();
  el('keyState').textContent = `removed “${p.name}”`;
}

async function onLoadAll() {
  // Each run is a different business: a selection carried over from the last
  // one inflates the "N selected" count with ids that are no longer on screen.
  state.selected.clear();
  el('loadBtn').disabled = true;
  el('stopBtn').hidden = false;
  el('loadbar').hidden = false;
  setStatus('Loading photos…', true);
  const onMsg = (msg) => { if (msg?.type === 'PROGRESS') setStatus(`Loading… ${msg.loaded} found`, true); };
  chrome.runtime.onMessage.addListener(onMsg);
  await send({ type: 'LOAD_ALL' }).catch(() => {});
  chrome.runtime.onMessage.removeListener(onMsg);
  el('loadbar').hidden = true;
  el('stopBtn').hidden = true;
  el('loadBtn').disabled = false;

  const res = await send({ type: 'GET_ITEMS' }).catch(() => null);
  if (!res) { setStatus('Could not read photos from the page', false); return; }
  state.items = res.items || [];
  if (!state.items.length) {
    const stale = res.health?.reachedTier === 'none';
    setStatus(stale ? `${SITE_LABEL[state.site]} adapter may be stale (0 found)` : 'No photos found — open the gallery', false);
    return;
  }
  setStatus(`${state.items.length} photos · ${SITE_LABEL[state.site] || state.site}`, true);
  el('controls').hidden = false;
  state.items.forEach((p) => state.selected.add(p.id));
  renderFilters();
  renderGrid();
}

function renderFilters() {
  const cats = [...new Set(state.items.map((p) => p.category).filter(Boolean))];
  const box = el('filters'); box.innerHTML = '';
  if (!cats.length) return;
  const mk = (label, value) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.activeCategory === value ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { state.activeCategory = value; renderFilters(); renderGrid(); });
    return b;
  };
  box.appendChild(mk('All', null));
  cats.forEach((c) => box.appendChild(mk(c, c)));
}

function visibleItems() {
  return state.activeCategory ? state.items.filter((p) => p.category === state.activeCategory) : state.items;
}

function renderGrid() {
  const grid = el('grid'); grid.innerHTML = '';
  visibleItems().forEach((p, idx) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell' + (state.selected.has(p.id) ? ' selected' : '');
    cell.dataset.id = p.id;
    cell.style.setProperty('--i', idx % 30);
    const img = document.createElement('img');
    img.loading = 'lazy'; img.src = p.thumbUrl; img.referrerPolicy = 'no-referrer'; img.alt = '';
    const check = document.createElement('span');
    check.className = 'check'; check.innerHTML = SVG.check;
    cell.appendChild(img); cell.appendChild(check);
    cell.addEventListener('click', () => {
      const has = state.selected.has(p.id);
      if (has) state.selected.delete(p.id); else state.selected.add(p.id);
      cell.classList.toggle('selected', !has);
      updateSelUI();
    });
    grid.appendChild(cell);
  });
  updateSelUI();
}

function refreshSelection() {
  for (const c of el('grid').children) c.classList.toggle('selected', state.selected.has(c.dataset.id));
}

function updateSelUI() {
  el('selCount').innerHTML = `<b>${state.selected.size}</b> selected`;
  el('downloadBtn').disabled = state.selected.size === 0;
  el('uploadBtn').disabled = state.selected.size === 0;
}

function resolveUrl(item, resolution) {
  if (item.site === 'google-maps' && resolution && resolution !== 'original') {
    return toGoogleSize(item.thumbUrl, 'w' + resolution);
  }
  return item.originalUrl;
}

async function fetchBlob(url, signal) {
  try {
    const r = await fetch(url, { signal, credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.blob();
  } catch (e) {
    if (signal?.aborted) throw e;
    const relay = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url }).catch(() => null);
    if (relay?.ok) return base64ToBlob(relay.base64, relay.mime);
    throw e;
  }
}

async function onDownload() {
  const chosen = state.items.filter((p) => state.selected.has(p.id));
  const resolution = el('resolution').value;
  const mode = document.querySelector('input[name=mode]:checked').value;
  const tpl = el('nameTpl').value || '{business}/{business}_{index}';
  state.abort = new AbortController();
  el('downloadBtn').disabled = true;
  el('report').innerHTML = '';
  el('dlbar').hidden = false; setFill('dlFill', 0);
  let done = 0;
  const total = chosen.length;

  if (mode === 'files') {
    const out = await runPool(chosen, async (item, i) => {
      const url = resolveUrl(item, resolution);
      const filename = buildFilename(tpl, { business: state.businessName, index: i + 1, ext: extOf(url) });
      await downloadUrl(url, filename);
      done++; el('progress').textContent = `Downloaded ${done}/${total}`; setFill('dlFill', (done / total) * 100);
    }, { concurrency: 5, signal: state.abort.signal });
    showReport(out);
  } else {
    const entries = [];
    const out = await runPool(chosen, async (item, i, signal) => {
      const url = resolveUrl(item, resolution);
      const blob = await withRetry(() => fetchBlob(url, signal), {
        retries: 3, baseMs: 400, maxMs: 6000, signal,
        isRetryable: (e) => !/HTTP 4\d\d/.test(String(e.message)),
      });
      entries.push({ name: buildFilename(tpl, { business: state.businessName, index: i + 1, ext: extOf(url) }), input: blob });
      done++; el('progress').textContent = `Fetched ${done}/${total}`; setFill('dlFill', (done / total) * 92);
    }, { concurrency: 6, signal: state.abort.signal });

    if (entries.length) {
      el('progress').textContent = `Zipping ${entries.length} photos…`;
      const zip = await buildZipBlob(entries);
      await downloadBlob(zip, `${sanitizeZipName(state.businessName)}.zip`);
      setFill('dlFill', 100);
      el('progress').textContent = `ZIP ready · ${entries.length} photos`;
    }
    showReport(out);
  }
  el('downloadBtn').disabled = false;
}

function showReport(out) {
  const box = el('report');
  box.innerHTML = `<div class="ok">${SVG.ok}${out.succeeded.length} done${out.failed.length ? ` · ${out.failed.length} failed` : ''}</div>`;
  if (out.failed.length) {
    const pre = document.createElement('div');
    pre.className = 'fail';
    pre.textContent = out.failed.map((f) => `#${f.index + 1}: ${f.reason}`).join('\n');
    box.appendChild(pre);
  }
}

// --- imgbb upload ---
async function onUpload() {
  const key = activeKey();
  if (!key) {
    el('imgbbProgress').textContent = 'Add an imgbb account first.';
    el('keySelect').value = '__add';
    el('keyForm').hidden = false;
    el('keyName')?.focus();
    return;
  }

  const chosen = state.items.filter((p) => state.selected.has(p.id));
  const resolution = el('resolution').value;
  state.abort = new AbortController();
  el('uploadBtn').disabled = true;
  el('imgbbResults').innerHTML = '';
  el('imgbbbar').hidden = false; setFill('imgbbFill', 0);
  const base = sanitizeSegment(state.businessName);
  const uploaded = [];
  let done = 0;
  const total = chosen.length;

  const out = await runPool(chosen, async (item, i, signal) => {
    const src = resolveUrl(item, resolution);
    const name = `${base}_${String(i + 1).padStart(3, '0')}`;
    let res;
    try {
      res = await withRetry(() => uploadByUrl(key, src, name, signal), {
        retries: 2, baseMs: 800, maxMs: 6000, signal, isRetryable: (e) => !isBadKeyError(e),
      });
    } catch (e) {
      if (isBadKeyError(e)) throw e;
      const blob = await fetchBlob(src, signal);
      const b64 = await blobToBase64(blob);
      res = await uploadByBase64(key, b64, name, signal);
    }
    uploaded.push({ name, url: res.url });
    done++; el('imgbbProgress').textContent = `Uploaded ${done}/${total}`; setFill('imgbbFill', (done / total) * 100);
  }, { concurrency: 3, signal: state.abort.signal });

  renderImgbbResults(uploaded, out);
  el('uploadBtn').disabled = false;
}

function renderImgbbResults(uploaded, out) {
  const box = el('imgbbResults');
  box.innerHTML = '';
  if (!uploaded.length) {
    const f = document.createElement('div'); f.className = 'fail';
    f.textContent = `No uploads succeeded (${out.failed.length} failed).` +
      (out.failed.length ? '\n' + out.failed.map((x) => `#${x.index + 1}: ${x.reason}`).join('\n') : '');
    box.appendChild(f);
    return;
  }
  const urls = uploaded.map((u) => u.url).join('\n');

  const head = document.createElement('div');
  head.className = 'results-head';
  head.innerHTML = `<span class="ok">${SVG.ok}${uploaded.length} uploaded${out.failed.length ? ` · ${out.failed.length} failed` : ''}</span>`;
  const copyAll = document.createElement('button');
  copyAll.className = 'btn btn-primary copy-all';
  copyAll.innerHTML = `${SVG.copy}<span>Copy all</span>`;
  copyAll.addEventListener('click', () => flashCopy(copyAll, urls, copyAll.querySelector('span'), 'Copy all'));
  head.appendChild(copyAll);
  box.appendChild(head);

  const list = document.createElement('div'); list.className = 'url-list';
  uploaded.forEach((u, i) => {
    const row = document.createElement('div'); row.className = 'url-row';
    row.style.animationDelay = `${Math.min(i, 12) * 25}ms`;
    const ic = document.createElement('span'); ic.className = 'ic'; ic.innerHTML = SVG.link;
    const a = document.createElement('a'); a.href = u.url; a.target = '_blank'; a.rel = 'noreferrer';
    a.textContent = u.url.replace(/^https?:\/\//, '');
    const mini = document.createElement('button'); mini.className = 'mini'; mini.title = 'Copy URL'; mini.innerHTML = SVG.copy;
    mini.addEventListener('click', () => flashCopy(mini, u.url, null, null));
    row.appendChild(ic); row.appendChild(a); row.appendChild(mini);
    list.appendChild(row);
  });
  box.appendChild(list);

  if (out.failed.length) {
    const f = document.createElement('div'); f.className = 'fail';
    f.textContent = out.failed.map((x) => `#${x.index + 1}: ${x.reason}`).join('\n');
    box.appendChild(f);
  }
}

async function flashCopy(btn, text, labelEl, labelText) {
  await copyText(text);
  if (labelEl) {
    labelEl.textContent = 'Copied!';
    setTimeout(() => { labelEl.textContent = labelText; }, 1400);
  } else {
    btn.innerHTML = SVG.ok; btn.classList.add('done');
    setTimeout(() => { btn.innerHTML = SVG.copy; btn.classList.remove('done'); }, 1400);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// --- helpers ---
function send(msg) { return chrome.tabs.sendMessage(state.tabId, msg); }
function setFill(id, pct) { el(id).style.width = Math.max(0, Math.min(100, pct)) + '%'; }
function extOf(url) { const m = url.split('?')[0].match(/\.(jpe?g|png|webp)$/i); return m ? m[1].toLowerCase() : 'jpg'; }
function guessBusinessName(title) {
  if (!title) return 'business';
  return title.replace(/ - Google Maps.*$/i, '').replace(/\s*\|\s*Yelp.*$/i, '').trim() || 'business';
}
function sanitizeZipName(s) { return String(s).replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'photos'; }
function base64ToBlob(b64, mime) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/jpeg' });
}
