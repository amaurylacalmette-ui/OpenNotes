"use client";
/**
 * Shared page-content rendering used by the live canvas, exports,
 * thumbnails and the page overview. Keeps every pipeline pixel-consistent.
 */
import {
  isImage,
  isText,
  isStroke,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TEXT_FONT_STACK,
  type PageData,
  type PageElement,
  type TextElement,
} from "./types";
import { drawPaper } from "./paper";
import { drawStroke, TEXT_LINE_HEIGHT, wrapText } from "./ink";

/** Async image loader (data URLs, remote URLs). */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

/**
 * Cache of decoded images keyed by src. When an image finishes loading
 * the callback fires so hosts can re-render once it becomes drawable.
 */
export class ImageCache {
  private map = new Map<string, HTMLImageElement>();
  constructor(private onLoad: () => void) {}

  /** Returns the decoded image, or null while still loading. */
  get(src: string): HTMLImageElement | null {
    let img = this.map.get(src);
    if (!img) {
      img = new Image();
      img.decoding = "async";
      img.onload = () => this.onLoad();
      img.src = src;
      this.map.set(src, img);
      return null;
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
}

export function drawTextElement(ctx: CanvasRenderingContext2D, el: TextElement): void {
  if (el.text.length === 0) return;
  ctx.save();
  ctx.fillStyle = el.color;
  ctx.font = `500 ${el.fontSize}px ${TEXT_FONT_STACK}`;
  ctx.textBaseline = "top";
  const lines = wrapText(ctx, el);
  const lh = el.fontSize * TEXT_LINE_HEIGHT;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], el.x, el.y + i * lh);
  }
  ctx.restore();
}

export function drawImageElement(
  ctx: CanvasRenderingContext2D,
  el: PageElement,
  cache: ImageCache
): void {
  if (!isImage(el)) return;
  const img = cache.get(el.src);
  if (!img) return; // onLoad will trigger a re-render
  ctx.save();
  ctx.drawImage(img, el.x, el.y, el.width, el.height);
  ctx.restore();
}

/** Draw every element (optionally skipping a set of ids). */
export function drawElements(
  ctx: CanvasRenderingContext2D,
  elements: PageElement[],
  cache: ImageCache,
  exclude?: Set<string>
): void {
  for (const el of elements) {
    if (exclude?.has(el.id)) continue;
    if (isStroke(el)) drawStroke(ctx, el, true);
    else if (isText(el)) drawTextElement(ctx, el);
    else drawImageElement(ctx, el, cache);
  }
}

/**
 * Render a full page (paper + optional PDF background + content) into a
 * canvas at the given pixel scale. Async because backgrounds and images
 * must be decoded first.
 */
export async function renderPage(
  canvas: HTMLCanvasElement,
  page: Pick<PageData, "template" | "elements" | "background">,
  pixelScale: number
): Promise<void> {
  canvas.width = Math.round(PAGE_WIDTH * pixelScale);
  canvas.height = Math.round(PAGE_HEIGHT * pixelScale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  drawPaper(ctx, page.template, pixelScale);

  if (page.background) {
    try {
      const img = await loadImage(page.background);
      ctx.save();
      ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
      ctx.drawImage(img, 0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      ctx.restore();
    } catch {
      /* missing background — keep the paper */
    }
  }

  const cache = new ImageCache(() => {});
  // pre-decode so the single draw pass below is synchronous & complete
  await Promise.all(
    page.elements
      .filter((el): el is Extract<PageElement, { kind: "image" }> => isImage(el))
      .map((el) => cache.get(el.src) ? Promise.resolve() : loadImage(el.src).catch(() => null))
  );
  ctx.save();
  ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  drawElements(ctx, page.elements, cache);
  ctx.restore();
}
