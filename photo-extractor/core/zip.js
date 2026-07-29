import { downloadZip } from '../vendor/client-zip.js';

// entries: iterable/async-iterable of { name, input, lastModified? }
// input may be string | Uint8Array | ArrayBuffer | Blob | Response.
export async function buildZipBlob(entries) {
  const response = downloadZip(entries);
  return await response.blob();
}
