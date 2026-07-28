// chrome.downloads wrappers. Runs in an extension page (side panel) or service worker.

export function downloadUrl(url, filename) {
  return chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
}

// Download an in-memory Blob (e.g. a generated ZIP). MUST run in an extension PAGE
// context (side panel), because URL.createObjectURL does not exist in the SW.
export async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: true });
  // Revoke only after the download has actually started, or the file may be empty.
  const onChanged = (delta) => {
    if (delta.id === id && delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
      URL.revokeObjectURL(url);
      chrome.downloads.onChanged.removeListener(onChanged);
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
  return id;
}
