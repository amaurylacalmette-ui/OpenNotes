/**
 * Ink geometry helpers — stroke outline generation, hit testing and
 * eraser splitting. Built on top of perfect-freehand for the
 * pressure-sensitive variable-width outline generation.
 */
import { getStroke } from "perfect-freehand";
import {
  isImage,
  isStroke,
  isText,
  TEXT_FONT_STACK,
  type ImageElement,
  type InkPoint,
  type PageElement,
  type Stroke,
  type TextElement,
} from "./types";

interface StrokeOptions {
  size: number;
  color: string;
  tool: Stroke["tool"];
  /** false while the stroke is still being drawn (adds end taper) */
  committed: boolean;
}

/**
 * Generate the variable-width outline polygon for a stroke.
 * Real stylus pressure drives width thinning; mouse/finger input gets
 * velocity-simulated pressure instead.
 */
export function strokeOutline(points: InkPoint[], opts: StrokeOptions): number[][] {
  const highlighter = opts.tool === "highlighter";
  return getStroke(
    points.map((pt) => [pt.x, pt.y, pt.p]),
    {
      size: opts.size,
      // highlighters keep a constant width; pens thin with pressure
      thinning: highlighter ? 0 : 0.58,
      smoothing: 0.62,
      streamline: highlighter ? 0.44 : 0.38,
      easing: (t) => t * (2 - t),
      simulatePressure: false,
      start: { taper: highlighter ? 0 : Math.min(opts.size * 0.8, 14), cap: true },
      end: { taper: committedTaper(opts, highlighter), cap: true },
      last: opts.committed,
    }
  );
}

function committedTaper(opts: StrokeOptions, highlighter: boolean): number {
  if (highlighter) return 0;
  // committed strokes get a small natural taper; live strokes taper via `last`
  return opts.committed ? Math.min(opts.size * 0.6, 10) : 0;
}

/**
 * Build a Path2D from a perfect-freehand outline using quadratic curves
 * through midpoints — the standard smooth fill used by the library demo.
 */
export function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const len = outline.length;
  if (len === 0) return path;
  if (len < 3) {
    const [x, y] = outline[0];
    path.arc(x, y, Math.max(0.4, (outline[0][2] ?? 1) * 0.5), 0, Math.PI * 2);
    return path;
  }
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < len; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % len];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

/** Render a stroke onto a 2D context in page-space (ctx already transformed). */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  committed: boolean
): void {
  if (stroke.points.length === 0) return;
  const outline = strokeOutline(stroke.points, {
    size: stroke.size,
    color: stroke.color,
    tool: stroke.tool,
    committed,
  });
  const path = outlineToPath(outline);
  if (stroke.tool === "highlighter") {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = stroke.color;
    ctx.fill(path);
    ctx.restore();
  } else {
    ctx.fillStyle = stroke.color;
    ctx.fill(path);
  }
}

/** Bounding box in page space. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Rough height of one text line — must match the renderer. */
export const TEXT_LINE_HEIGHT = 1.42;

/** Bounding box of a stroke, padded by half its width. */
export function strokeBounds(stroke: Stroke): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of stroke.points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  const pad = stroke.size / 2 + 1;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Squared distance from point p to segment ab. */
function sqSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/**
 * True when the eraser circle at (x, y, radius) touches the stroke.
 * Fast bounds rejection first, then per-segment distance checks.
 */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const b = strokeBounds(stroke);
  if (x < b.minX - radius || x > b.maxX + radius || y < b.minY - radius || y > b.maxY + radius) {
    return false;
  }
  const rSq = (radius + stroke.size / 2) * (radius + stroke.size / 2);
  const pts = stroke.points;
  if (pts.length === 1) {
    const dx = pts[0].x - x;
    const dy = pts[0].y - y;
    return dx * dx + dy * dy <= rSq;
  }
  for (let i = 1; i < pts.length; i++) {
    if (sqSegDist(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= rSq) return true;
  }
  return false;
}

/**
 * Precision eraser: remove points within the eraser radius and split the
 * stroke into the surviving contiguous runs. Returns the replacement
 * strokes (empty array when nothing survives). New strokes keep the
 * original tool, color and size.
 */
export function eraseStrokePrecise(
  stroke: Stroke,
  x: number,
  y: number,
  radius: number,
  makeId: () => string
): Stroke[] {
  const rSq = radius * radius;
  const runs: InkPoint[][] = [];
  let current: InkPoint[] = [];
  for (const pt of stroke.points) {
    const dx = pt.x - x;
    const dy = pt.y - y;
    if (dx * dx + dy * dy <= rSq) {
      if (current.length > 1) runs.push(current);
      current = [];
    } else {
      current.push(pt);
    }
  }
  if (current.length > 1) runs.push(current);

  return runs.map((points) => ({
    id: makeId(),
    tool: stroke.tool,
    color: stroke.color,
    size: stroke.size,
    points,
    hasRealPressure: stroke.hasRealPressure,
  }));
}

/* ================================ selection ================================ */

export function textBounds(el: TextElement): Bounds {
  const lines = el.text.length > 0 ? Math.max(1, el.text.split("\n").length) : 1;
  const w = el.text.length === 0 ? 160 : measureTextWidth(el);
  return {
    minX: el.x,
    minY: el.y,
    maxX: el.x + w,
    maxY: el.y + lines * el.fontSize * TEXT_LINE_HEIGHT,
  };
}

/** Lazily-created offscreen 2D context for text measurement. */
let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}

/** Word-wrap a text element into canvas lines for its wrap width. */
export function wrapText(ctx: CanvasRenderingContext2D, el: TextElement): string[] {
  ctx.font = `500 ${el.fontSize}px ${TEXT_FONT_STACK}`;
  const out: string[] = [];
  for (const paragraph of el.text.split("\n")) {
    if (paragraph.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (ctx.measureText(candidate).width > el.width && line.length > 0) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out;
}

function measureTextWidth(el: TextElement): number {
  const ctx = getMeasureCtx();
  if (!ctx) return 120;
  const lines = wrapText(ctx, el);
  let w = 0;
  for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
  return Math.max(40, w);
}

export function imageBounds(el: ImageElement): Bounds {
  return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
}

export function elementBounds(el: PageElement): Bounds {
  if (isText(el)) return textBounds(el);
  if (isImage(el)) return imageBounds(el);
  return strokeBounds(el);
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}

/** Move an element by (dx, dy) in page space (mutates the element). */
export function translateElement(el: PageElement, dx: number, dy: number): void {
  if (isText(el)) {
    el.x += dx;
    el.y += dy;
  } else if (isImage(el)) {
    el.x += dx;
    el.y += dy;
  } else {
    for (const pt of el.points) {
      pt.x += dx;
      pt.y += dy;
    }
  }
}

/** Even-odd ray-casting point-in-polygon test. */
export function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when at least one stroke point falls inside the lasso polygon. */
export function strokeIntersectsPolygon(stroke: Stroke, poly: { x: number; y: number }[]): boolean {
  for (const pt of stroke.points) {
    if (pointInPolygon(pt.x, pt.y, poly)) return true;
  }
  return false;
}

/** Elements touched by the lasso polygon. */
export function elementsInPolygon(
  elements: PageElement[],
  poly: { x: number; y: number }[]
): string[] {
  const hits: string[] = [];
  for (const el of elements) {
    if (isStroke(el)) {
      if (strokeIntersectsPolygon(el, poly)) hits.push(el.id);
    } else {
      const b = elementBounds(el);
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      if (pointInPolygon(cx, cy, poly)) hits.push(el.id);
    }
  }
  return hits;
}

/* ============================ shape recognition ============================ */

type Pt = { x: number; y: number };

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Ramer–Douglas–Peucker polyline simplification. */
export function simplify(points: Pt[], eps: number): Pt[] {
  if (points.length < 3) return [...points];
  let maxDist = 0;
  let index = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > eps) {
    const left = simplify(points.slice(0, index + 1), eps);
    const right = simplify(points.slice(index), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [a, b];
}

export interface ShapeResult {
  /** vertex polyline for line/triangle/quad; sampled outline for ellipse */
  points: Pt[];
  label: "line" | "triangle" | "rectangle" | "ellipse" | "polyline";
}

/**
 * Recognize a hand-drawn shape: straight line, triangle, rectangle,
 * ellipse, or fall back to the raw polyline. Classic GoodNotes-style
 * snapping — deterministic, fast and tuned for touch input.
 */
export function recognizeShape(raw: InkPoint[]): ShapeResult | null {
  if (raw.length < 3) return null;
  const pts: Pt[] = raw.map((p) => ({ x: p.x, y: p.y }));

  let pathLen = 0;
  for (let i = 1; i < pts.length; i++) pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (pathLen < 24) return null;

  const bbox = {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  const eps = Math.max(5, diag * 0.045);

  const first = pts[0];
  const last = pts[pts.length - 1];
  const closeDist = Math.hypot(last.x - first.x, last.y - first.y);
  const isClosed = closeDist < Math.max(28, pathLen * 0.16);

  if (!isClosed) {
    // straight line? deviation from the chord relative to its length
    const chord = closeDist;
    let maxDev = 0;
    for (const p of pts) maxDev = Math.max(maxDev, perpDist(p, first, last));
    if (chord > 30 && maxDev / chord < 0.09) {
      return { points: [first, last], label: "line" };
    }
    const simplified = simplify(pts, eps);
    return simplified.length >= 2 ? { points: simplified, label: "polyline" } : null;
  }

  // closed shapes: round (circle/ellipse) vs polygon (triangle/quad/rect)
  // first drop a trailing tail that loops back over the start point
  let endIdx = pts.length - 1;
  while (endIdx > 3 && Math.hypot(pts[endIdx].x - pts[0].x, pts[endIdx].y - pts[0].y) < 14) {
    endIdx--;
  }
  const loop = pts.slice(0, endIdx + 1);

  const area = polygonArea(loop);
  const pathLenLoop = loop.reduce(
    (acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - loop[i - 1].x, p.y - loop[i - 1].y)),
    0
  );
  // shoelace area implicitly closes the loop — include the closing chord in the perimeter
  const closing = Math.hypot(loop[loop.length - 1].x - loop[0].x, loop[loop.length - 1].y - loop[0].y);
  const perimeter = pathLenLoop + closing;
  const circularity = perimeter > 0 ? (4 * Math.PI * Math.abs(area)) / (perimeter * perimeter) : 0;
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;

  if (
    circularity > 0.75 &&
    w > 24 &&
    h > 24 &&
    ellipseFitError(loop, bbox) < 0.14
  ) {
    // ellipse fitted to the bounding box
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const rx = w / 2;
    const ry = h / 2;
    const samples: Pt[] = [];
    const n = 56;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      samples.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    return { points: samples, label: "ellipse" };
  }

  // polygon: progressively coarser simplification until few vertices remain
  let verts: Pt[] = [];
  for (const k of [1, 1.8, 3, 5]) {
    verts = dedupeClose(simplify(loop, eps * k));
    if (verts.length <= 5) break;
  }
  // a corner drawn mid-edge splits one side — drop shallow-angle vertices
  while (verts.length > 4) {
    const idx = shallowestVertex(verts);
    if (idx < 0 || interiorAngleDeg(verts, idx) > 30) break;
    verts.splice(idx, 1);
  }

  if (verts.length === 3) {
    return { points: [...verts, verts[0]], label: "triangle" };
  }

  if (verts.length === 4) {
    // rectangle when the quad's edges are near-axis-aligned
    const axes = quadAxisError(verts);
    if (axes < 0.25) {
      return {
        points: [
          { x: bbox.minX, y: bbox.minY },
          { x: bbox.maxX, y: bbox.minY },
          { x: bbox.maxX, y: bbox.maxY },
          { x: bbox.minX, y: bbox.maxY },
          { x: bbox.minX, y: bbox.minY },
        ],
        label: "rectangle",
      };
    }
    return { points: [...verts, verts[0]], label: "polyline" };
  }

  return null;
}

function dedupeClose(pts: Pt[]): Pt[] {
  return pts.filter(
    (p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 2
  );
}

/**
 * Resample a sparse vertex polyline into a dense point list so the
 * perfect-freehand outline keeps straight edges straight (streamline
 * otherwise curves sparse corners into petals).
 */
export function densifyPolyline(pts: Pt[], step = 6): Pt[] {
  if (pts.length < 2) return [...pts];
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  return out;
}

function shallowestVertex(v: Pt[]): number {
  let best = -1;
  let bestAngle = 999;
  for (let i = 0; i < v.length; i++) {
    const a = interiorAngleDeg(v, i);
    if (a < bestAngle) {
      bestAngle = a;
      best = i;
    }
  }
  return best;
}

/** Interior angle at vertex i of a closed polygon, in degrees. */
function interiorAngleDeg(v: Pt[], i: number): number {
  const prev = v[(i - 1 + v.length) % v.length];
  const cur = v[i];
  const next = v[(i + 1) % v.length];
  const a1 = Math.atan2(prev.y - cur.y, prev.x - cur.x);
  const a2 = Math.atan2(next.y - cur.y, next.x - cur.x);
  let diff = Math.abs(a1 - a2);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return (diff * 180) / Math.PI;
}

function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

/** Mean deviation of points from the bbox-fitted ellipse, relative to the smaller radius. */
function ellipseFitError(pts: Pt[], bbox: { minX: number; minY: number; maxX: number; maxY: number }): number {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const rx = (bbox.maxX - bbox.minX) / 2;
  const ry = (bbox.maxY - bbox.minY) / 2;
  const minR = Math.min(rx, ry);
  if (minR < 1) return 1;
  let sum = 0;
  for (const p of pts) {
    const th = Math.atan2((p.y - cy) / ry, (p.x - cx) / rx);
    const ex = cx + rx * Math.cos(th);
    const ey = cy + ry * Math.sin(th);
    sum += Math.hypot(p.x - ex, p.y - ey);
  }
  return sum / pts.length / minR;
}

/** Average deviation of quad edges from the horizontal/vertical axes (0..1). */
function quadAxisError(v: Pt[]): number {
  const edges: [Pt, Pt][] = [
    [v[0], v[1]],
    [v[1], v[2]],
    [v[2], v[3]],
    [v[3], v[0]],
  ];
  let err = 0;
  for (const [a, b] of edges) {
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const len = Math.hypot(dx, dy) || 1;
    err += Math.min(dx, dy) / len;
  }
  return err / edges.length;
}
