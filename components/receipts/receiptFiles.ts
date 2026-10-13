// Browser-side helpers for getting a receipt to a client who has no email:
// download the PDF, turn it into a PNG (for texting), or hand both to the
// phone's share sheet. pdf.js is loaded on demand, only when a PNG is asked for.

import { receiptFileName } from "@/lib/receipts/compute";

export async function fetchReceiptPdf(receiptId: string): Promise<Blob> {
  const res = await fetch(`/api/receipts/${receiptId}/pdf`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not load the receipt PDF");
  return res.blob();
}

/**
 * Render every page of the PDF at `scale` and stack them into one PNG, so a
 * long receipt still arrives as a single image. Scale 2 = 1224px wide, sharp
 * on a phone and small enough for MMS.
 */
export async function receiptPdfToPng(pdf: Blob, scale = 2): Promise<Blob> {
  // The legacy build carries polyfills: the modern one calls JS APIs (e.g.
  // Map#getOrInsertComputed) that current Safari and older Chrome lack.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) }).promise;
  try {
    const pages: HTMLCanvasElement[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      pages.push(canvas);
    }

    const out = document.createElement("canvas");
    out.width = Math.max(...pages.map((c) => c.width));
    out.height = pages.reduce((h, c) => h + c.height, 0);
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("This browser can't draw images");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
    let y = 0;
    for (const c of pages) {
      ctx.drawImage(c, 0, y);
      y += c.height;
    }
    return await new Promise<Blob>((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image"))), "image/png")
    );
  } finally {
    await doc.destroy();
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True where the browser can share files (mostly phones), e.g. straight into Messages. */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], "x.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

export async function downloadReceiptPdf(receiptId: string, receiptNo: string): Promise<void> {
  downloadBlob(await fetchReceiptPdf(receiptId), receiptFileName(receiptNo, "pdf"));
}

export async function downloadReceiptPng(receiptId: string, receiptNo: string): Promise<void> {
  downloadBlob(await receiptPdfToPng(await fetchReceiptPdf(receiptId)), receiptFileName(receiptNo, "png"));
}

export type ReceiptFiles = { pdf: File; png: File };

/** Build both files ahead of time: the share sheet must open straight from the tap. */
export async function prepareReceiptFiles(receiptId: string, receiptNo: string): Promise<ReceiptFiles> {
  const pdf = await fetchReceiptPdf(receiptId);
  const png = await receiptPdfToPng(pdf);
  return {
    pdf: new File([pdf], receiptFileName(receiptNo, "pdf"), { type: "application/pdf" }),
    png: new File([png], receiptFileName(receiptNo, "png"), { type: "image/png" }),
  };
}

/**
 * Open the share sheet (Messages, WhatsApp, etc.) with the PNG and PDF.
 * Call directly from the click handler with already-prepared files; Safari
 * refuses share() once anything async has run after the tap.
 */
export function shareReceiptFiles(files: ReceiptFiles, receiptNo: string, businessName: string): Promise<void> {
  const both = [files.png, files.pdf];
  // Some targets only take one kind of file; the image is what texts best.
  const list = navigator.canShare?.({ files: both }) ? both : [files.png];
  return navigator.share({ files: list, title: `Payment receipt ${receiptNo}`, text: `Payment receipt for ${businessName}` });
}
