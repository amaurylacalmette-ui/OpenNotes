/**
 * OpenNotes core data model.
 * Everything is plain JSON-serializable so notebooks can be exported,
 * backed up, or synced later without format migrations.
 */

export type ToolId =
  | "pen"
  | "highlighter"
  | "eraser-precise"
  | "eraser-stroke"
  | "laser"
  | "lasso"
  | "text"
  | "shape"
  | "image";

export type PaperTemplate = "blank" | "lined" | "grid" | "dotted";

/** A single sampled input point in page-space coordinates. */
export interface InkPoint {
  /** horizontal position in page units (logical px at 1x zoom) */
  x: number;
  /** vertical position in page units */
  y: number;
  /** normalized pressure 0..1 (real stylus pressure, or simulated for mouse/finger) */
  p: number;
  /** timestamp (ms) — used by the laser tool and velocity heuristics */
  t: number;
}

export type InkTool = "pen" | "highlighter";

/** A committed (or in-progress) ink stroke. */
export interface Stroke {
  kind?: "stroke";
  id: string;
  tool: InkTool;
  /** CSS color string */
  color: string;
  /** base stroke width in page units */
  size: number;
  points: InkPoint[];
  /** true when at least one point carries real hardware pressure */
  hasRealPressure?: boolean;
}

/** An editable text box anchored at its top-left corner in page space. */
export interface TextElement {
  kind: "text";
  id: string;
  x: number;
  y: number;
  /** wrap width in page units (auto-grows vertically) */
  width: number;
  text: string;
  fontSize: number;
  color: string;
}

/** A raster image placed on the page (photo, screenshot, diagram…). */
export interface ImageElement {
  kind: "image";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** data URL — keeps everything local and serializable */
  src: string;
}

export type PageElement = Stroke | TextElement | ImageElement;

export function isStroke(el: PageElement): el is Stroke {
  return el.kind !== "text" && el.kind !== "image";
}
export function isText(el: PageElement): el is TextElement {
  return el.kind === "text";
}
export function isImage(el: PageElement): el is ImageElement {
  return el.kind === "image";
}

/** Deep clone — stroke points are copied so gestures/ops never share them. */
export function cloneElement(el: PageElement): PageElement {
  if (isStroke(el)) {
    return { ...el, points: el.points.map((p) => ({ ...p })) };
  }
  return { ...el };
}

/** Undo/redo operations. Every edit is expressed as an invertible op. */
export type HistoryOp =
  | { type: "add"; elements: PageElement[] }
  | { type: "remove"; elements: PageElement[] }
  | { type: "replace"; before: PageElement[]; after: PageElement[] };

export interface PageData {
  id: string;
  notebookId: string;
  index: number;
  template: PaperTemplate;
  /** all content on the page: ink, text boxes and images */
  elements: PageElement[];
  /** optional full-page raster background (imported PDF page) */
  background?: string;
  bookmarked?: boolean;
  updatedAt: number;
}

/** Accepts legacy v1 page records (`strokes` array) and current records. */
export function normalizePage(raw: Partial<PageData> & Record<string, unknown>): PageData {
  const legacyStrokes = (raw.strokes as Stroke[] | undefined) ?? [];
  const elements =
    (raw.elements as PageElement[] | undefined) ??
    legacyStrokes.map((s) => ({ ...s, kind: "stroke" as const }));
  return {
    id: raw.id as string,
    notebookId: raw.notebookId as string,
    index: raw.index as number,
    template: (raw.template as PaperTemplate) ?? "blank",
    elements,
    background: raw.background as string | undefined,
    bookmarked: raw.bookmarked as boolean | undefined,
    updatedAt: (raw.updatedAt as number) ?? Date.now(),
  };
}

export interface NotebookMeta {
  id: string;
  title: string;
  /** index into the COVER_COLORS palette */
  coverColor: number;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Logical page size — A4 ratio at ~150 dpi. */
export const PAGE_WIDTH = 1240;
export const PAGE_HEIGHT = 1754;

export const COVER_COLORS = [
  { name: "Caramel", base: "#b07a4a", dark: "#8a5a32", light: "#d3a678" },
  { name: "Rust", base: "#a85138", dark: "#7e3a26", light: "#c97a5f" },
  { name: "Olive", base: "#7d8b4e", dark: "#5d6838", light: "#a3b177" },
  { name: "Plum", base: "#8e5a79", dark: "#6b4159", light: "#b183a0" },
  { name: "Charcoal", base: "#4f4c48", dark: "#383633", light: "#7a7671" },
  { name: "Mustard", base: "#c9973b", dark: "#9c7228", light: "#ddb569" },
] as const;

/** Default pen palette (ink colors, distinct from UI chrome). */
export const INK_COLORS = [
  "#1f1b16", // black
  "#d6453d", // red
  "#e8862e", // orange
  "#e5b32e", // yellow
  "#3e9b4f", // green
  "#2f6fbf", // blue
  "#7a4fb0", // violet
  "#8a5a32", // brown
] as const;

export const PEN_SIZES = [2, 4, 7, 12, 20] as const;
export const HIGHLIGHTER_SIZES = [14, 22, 32, 46, 64] as const;
export const ERASER_SIZES = [12, 24, 40, 64] as const;
export const TEXT_SIZES = [16, 22, 28, 36, 48] as const;

/** Highlighter palette — brighter, semi-transparent inks. */
export const HIGHLIGHTER_COLORS = [
  "#ffd93d", // yellow
  "#9be07a", // green
  "#ff9ecb", // pink
  "#ffb26b", // peach
  "#8ecdf7", // sky
  "#c6a5f7", // lilac
] as const;

export const TEXT_FONT_STACK =
  'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export function uid(prefix = ""): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}
