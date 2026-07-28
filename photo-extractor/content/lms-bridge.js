// Runs on the LMS origin ONLY. The bridge between the web page and the
// extension.
//
// WHY THIS DIRECTION. An unpacked extension's ID is a hash of the folder it was
// loaded from, and every agent unzips somewhere different — so the page has no
// stable ID to call `chrome.runtime.sendMessage(id, …)` with. Instead the
// extension announces itself and the page answers. No ID anywhere.
(() => {
  const PAGE = 'sed-lms';
  const EXT = 'sed-photo-ext';
  const version = chrome.runtime.getManifest().version;

  const post = (msg) => window.postMessage({ source: EXT, ...msg }, window.location.origin);

  window.addEventListener('message', (event) => {
    // Only messages this page sent to itself. Anything else is not ours.
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== PAGE) return;

    if (data.type === 'PING') { post({ type: 'READY', version }); return; }

    if (data.type === 'CAPTURE') {
      chrome.runtime.sendMessage({ type: 'CAPTURE', url: data.url, max: data.max }, (res) => {
        if (chrome.runtime.lastError) {
          post({ type: 'ERROR', requestId: data.requestId, error: chrome.runtime.lastError.message });
          return;
        }
        if (res?.ok) post({ type: 'DONE', requestId: data.requestId, photos: res.photos, version });
        else post({ type: 'ERROR', requestId: data.requestId, error: res?.error || 'Capture failed' });
      });
    }
  });

  // Relay progress pushed by the service worker mid-capture.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'CAPTURE_PROGRESS') post({ type: 'PROGRESS', loaded: msg.loaded });
  });

  post({ type: 'READY', version });
})();
