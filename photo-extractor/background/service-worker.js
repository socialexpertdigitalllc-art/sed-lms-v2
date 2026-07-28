import { toWirePhotos, MAX_PHOTOS } from '../core/capture.js';

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.warn(e));
});

// Fallback image fetch: used only when a side-panel page-context fetch fails.
// Returns base64 because chrome messaging cannot transfer ArrayBuffer.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'FETCH_IMAGE') {
    (async () => {
      try {
        const resp = await fetch(msg.url, { credentials: 'omit' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        sendResponse({ ok: true, base64: toBase64(buf), mime: resp.headers.get('content-type') || 'image/jpeg' });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true; // async
  }
});

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ---- automatic capture, driven by the LMS page ----
//
// The popup window must be VISIBLE: Chrome throttles timers and suspends
// rendering in hidden tabs, which starves the gallery scroll loop. Unfocused is
// fine, minimized is not — so we open a real window, unfocused, and close it.
const CAPTURE_TIMEOUT_MS = 90_000;
let capturing = false;

function toDotCom(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // google.co.uk/maps/place/X → www.google.com/maps/place/X. The content
    // script only matches .com hosts; without this, a ccTLD link opens a window
    // where nothing is injected and the capture silently returns zero photos.
    if (/^(?:www\.)?google\./.test(u.hostname)) u.hostname = "www.google.com";
    else if (/^maps\.google\./.test(u.hostname)) u.hostname = "maps.google.com";
    return u.toString();
  } catch { return rawUrl; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'CAPTURE') return;
  (async () => {
    if (capturing) { sendResponse({ ok: false, error: 'Another capture is already running' }); return; }
    capturing = true;
    let windowId = null;
    try {
      const url = toDotCom(msg.url);
      const win = await chrome.windows.create({ url, type: 'popup', focused: false, width: 1100, height: 900 });
      windowId = win.id;
      const tabId = win.tabs?.[0]?.id;
      if (!tabId) throw new Error('Could not open the capture window');

      await waitForLoad(tabId);
      await withTimeout(chrome.tabs.sendMessage(tabId, { type: 'LOAD_ALL' }), CAPTURE_TIMEOUT_MS);
      const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_ITEMS' });
      const photos = toWirePhotos(res?.items ?? [], msg.max || MAX_PHOTOS);
      sendResponse({ ok: true, photos });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    } finally {
      capturing = false;
      if (windowId != null) { try { await chrome.windows.remove(windowId); } catch { /* already closed */ } }
    }
  })();
  return true; // async sendResponse
});

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('The profile page did not finish loading')); }, 30_000);
    const listener = (id, info) => {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      // The content script runs at document_idle; give it a beat to register.
      setTimeout(resolve, 1200);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Capture timed out')), ms)),
  ]);
}
