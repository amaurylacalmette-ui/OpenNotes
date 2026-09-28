"use client";
/**
 * Export pipelines (PNG + PDF). Rendering goes through the shared
 * `renderPage` so exports match exactly what the user sees on the canvas.
 */
import type { PageData } from "./types";
import { renderPage } from "./render";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportPagePng(page: PageData, filename: string): Promise<void> {
  const canvas = document.createElement("canvas");
  await renderPage(canvas, page, 2);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );
  if (blob) downloadBlob(blob, filename);
}

export async function exportNotebookPdf(
  pages: PageData[],
  filename: string,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const canvas = document.createElement("canvas");

  for (let i = 0; i < pages.length; i++) {
    await renderPage(canvas, pages[i], 2);
    const data = canvas.toDataURL("image/jpeg", 0.92);
    if (i > 0) pdf.addPage();
    pdf.addImage(data, "JPEG", 0, 0, 595.28, 841.89);
    onProgress?.(i + 1, pages.length);
    // yield to the UI thread so the progress indicator can paint
    await new Promise((r) => setTimeout(r, 0));
  }
  pdf.save(filename);
}
