"use client";
/**
 * PDF import — renders each PDF page into a JPEG data URL that becomes
 * the fixed background of one OpenNotes page, ready for annotation.
 * pdf.js is loaded lazily so it never bloats the initial bundle.
 */
import { PAGE_WIDTH } from "./types";

export async function renderPdfToBackgrounds(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;

  const backgrounds: string[] = [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return backgrounds;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = PAGE_WIDTH / base.width;
    const viewport = page.getViewport({ scale });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    backgrounds.push(canvas.toDataURL("image/jpeg", 0.82));
    page.cleanup();
    onProgress?.(i, doc.numPages);
    // let the progress UI paint between pages
    await new Promise((r) => setTimeout(r, 0));
  }

  await doc.destroy();
  return backgrounds;
}
