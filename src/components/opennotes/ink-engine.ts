"use client";
/**
 * OpenNotes Ink Engine.
 *
 * A self-contained canvas rendering + input engine:
 *  - pressure-sensitive vector ink (perfect-freehand outlines)
 *  - pen / highlighter / precise eraser / stroke eraser / laser pointer
 *  - shape tool with line / triangle / rectangle / ellipse recognition
 *  - lasso selection: move strokes, images and text; resize images
 *  - text boxes with tap-to-edit hand-off to the host editor
 *  - images inserted from the host (drag to move, corner to resize)
 *  - fixed page backgrounds (imported PDF pages)
 *  - palm rejection (touch ignored while an Apple Pencil-style pen is active)
 *  - one- and two-finger pan & pinch-zoom, trackpad + ctrl-wheel zoom
 *  - element-level undo/redo with invertible ops
 *
 * Coordinate spaces:
 *  - page space: fixed 1240 x 1754 logical units, where ink lives
 *  - screen space: pixels relative to the container element
 *  - camera: { x, y, scale } with screen = page * scale + offset
 */
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  cloneElement,
  isImage,
  isStroke,
  isText,
  uid,
  type HistoryOp,
  type ImageElement,
  type InkPoint,
  type PageElement,
  type PaperTemplate,
  type Stroke,
  type TextElement,
  type ToolId,
} from "@/lib/opennotes/types";
import {
  drawStroke,
  densifyPolyline,
  elementsInPolygon,
  elementBounds,
  eraseStrokePrecise,
  recognizeShape,
  strokeHit,
  translateElement,
  unionBounds,
} from "@/lib/opennotes/ink";
import { drawPaper } from "@/lib/opennotes/paper";
import { ImageCache, drawElements, renderPage } from "@/lib/opennotes/render";

export interface InkEngineOptions {
  onHistoryChanged?: (canUndo: boolean, canRedo: boolean) => void;
  onCameraChanged?: (scale: number) => void;
  onContentChanged?: () => void;
  onSelectionChanged?: (hasSelection: boolean) => void;
  onTextEditStart?: (el: TextElement, isNew: boolean) => void;
}

/** Per-pointer bookkeeping in both coordinate spaces. */
interface PointerInfo {
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
  type: string;
}

type Mode =
  | "idle"
  | "draw"
  | "erase"
  | "laser"
  | "pan"
  | "lasso"
  | "gesture"
  | "textwait";

type GestureKind = "move" | "resize" | "textdrag";

const LASER_LIFE_MS = 700;
const MAX_UNDO = 250;

export class InkEngine {
  /* ---------------------------------- tool config ---------------------------------- */
  tool: ToolId = "pen";
  penColor = "#1f1b16";
  penSize = 4;
  highlighterColor = "#e5b32e";
  highlighterSize = 22;
  eraserSize = 24;
  textSize = 28;
  palmRejection = true;
  fingerDrawing = false;

  /* ------------------------------------ internals ----------------------------------- */
  private container: HTMLElement;
  private stage: HTMLElement;
  private paperCanvas: HTMLCanvasElement;
  private inkCanvas: HTMLCanvasElement;
  private liveCanvas: HTMLCanvasElement;
  private paperCtx: CanvasRenderingContext2D;
  private inkCtx: CanvasRenderingContext2D;
  private liveCtx: CanvasRenderingContext2D;

  private elements: PageElement[] = [];
  private undoStack: HistoryOp[] = [];
  private redoStack: HistoryOp[] = [];

  private camera = { x: 0, y: 0, scale: 1 };
  private renderScale = 1;
  private template: PaperTemplate = "blank";
  private background: string | null = null;
  private disposed = false;

  /* images */
  private contentImages: ImageCache;
  private bgImages: ImageCache;

  /* selection */
  private selection = new Set<string>();
  private textEditId: string | null = null;
  private editOriginal: PageElement | null = null;
  private editIsNew = false;

  /* input */
  private pointers = new Map<number, PointerInfo>();
  private mode: Mode = "idle";
  private activePointerId: number | null = null; // owns draw/erase/laser/lasso gestures
  private penDown = false; // a stylus is currently down → reject palms
  private currentStroke: Stroke | null = null;
  private lastPoint: InkPoint | null = null;
  private lastPressure = 0.5;
  private lastPanScreen: { x: number; y: number } | null = null;
  private gestureAnchor: {
    dist: number;
    scale: number;
    midX: number;
    midY: number;
    pageX: number;
    pageY: number;
  } | null = null;

  /* lasso */
  private lassoPts: InkPoint[] = [];

  /* move / resize / text-drag gesture */
  private gestureKind: GestureKind = "move";
  private gestureOriginals = new Map<string, PageElement>();
  private gestureStart = { x: 0, y: 0 };
  private gestureMoved = false;

  /* erase gesture accumulation */
  private erasedOriginals = new Map<string, Stroke>();
  private createdSubs = new Map<string, Stroke>();
  private removedStrokes = new Map<string, Stroke>();

  /* laser */
  private laserTrail: InkPoint[] = [];
  private laserRunning = false;

  /* misc */
  private hoverPoint: { x: number; y: number } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private zoomEndTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId = 0;
  private liveDirty = false;
  private opts: InkEngineOptions;

  constructor(
    container: HTMLElement,
    stage: HTMLElement,
    canvases: { paper: HTMLCanvasElement; ink: HTMLCanvasElement; live: HTMLCanvasElement },
    opts: InkEngineOptions = {}
  ) {
    this.container = container;
    this.stage = stage;
    this.paperCanvas = canvases.paper;
    this.inkCanvas = canvases.ink;
    this.liveCanvas = canvases.live;
    this.paperCtx = this.paperCanvas.getContext("2d")!;
    this.inkCtx = this.inkCanvas.getContext("2d")!;
    this.liveCtx = this.liveCanvas.getContext("2d")!;
    this.opts = opts;
    this.contentImages = new ImageCache(() => {
      if (!this.disposed) this.renderInk();
    });
    this.bgImages = new ImageCache(() => {
      if (!this.disposed) this.renderPaper();
    });

    this.stage.style.touchAction = "none";
    this.attachListeners();

    // initial backing-store setup — handleResize would skip this when the
    // effective scale happens to equal the default renderScale (e.g. dpr 1)
    this.sizeCanvases();
    this.renderPaper();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  destroy(): void {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.detachListeners();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.zoomEndTimer) clearTimeout(this.zoomEndTimer);
    this.laserRunning = false;
  }

  /* ================================= page data ================================= */

  setPage(template: PaperTemplate, elements: PageElement[], background?: string): void {
    this.template = template;
    this.background = background ?? null;
    this.elements = elements.map(cloneElement);
    this.undoStack = [];
    this.redoStack = [];
    this.selection.clear();
    this.textEditId = null;
    this.editOriginal = null;
    this.notifyHistory();
    this.notifySelection();
    // always re-render: template and content both changed
    this.sizeCanvases();
    this.renderPaper();
    this.renderInk();
    this.clearLive();
    this.clampCamera();
    this.applyCamera();
  }

  setTemplate(template: PaperTemplate): void {
    this.template = template;
    this.renderPaper();
  }

  getElements(): PageElement[] {
    return this.elements;
  }

  getTemplate(): PaperTemplate {
    return this.template;
  }

  getBackground(): string | null {
    return this.background;
  }

  getCameraScale(): number {
    return this.camera.scale;
  }

  getCamera(): { x: number; y: number; scale: number } {
    return { ...this.camera };
  }

  /* ================================= rendering ================================= */

  private effectiveRenderScale(): number {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return Math.min(2.5, Math.max(1, dpr * this.camera.scale));
  }

  private sizeCanvases(): void {
    const rs = this.effectiveRenderScale();
    this.renderScale = rs;
    for (const c of [this.paperCanvas, this.inkCanvas, this.liveCanvas]) {
      c.width = Math.round(PAGE_WIDTH * rs);
      c.height = Math.round(PAGE_HEIGHT * rs);
    }
    for (const ctx of [this.paperCtx, this.inkCtx, this.liveCtx]) {
      ctx.setTransform(rs, 0, 0, rs, 0, 0);
    }
  }

  private renderPaper(): void {
    drawPaper(this.paperCtx, this.template, this.renderScale);
    if (this.background) {
      const img = this.bgImages.get(this.background);
      if (img) {
        this.paperCtx.drawImage(img, 0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      }
    }
  }

  private renderInk(exclude?: Set<string>): void {
    this.inkCtx.save();
    this.inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.inkCtx.clearRect(0, 0, this.inkCanvas.width, this.inkCanvas.height);
    this.inkCtx.restore();
    drawElements(this.inkCtx, this.elements, this.contentImages, exclude);
  }

  private clearLive(): void {
    this.liveCtx.save();
    this.liveCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.liveCtx.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
    this.liveCtx.restore();
  }

  private applyCamera(): void {
    this.stage.style.transform = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.scale})`;
    this.opts.onCameraChanged?.(this.camera.scale);
    if (this.selection.size > 0 && this.mode === "idle") this.redrawLive();
  }

  private handleResize(): void {
    if (this.disposed) return;
    if (Math.abs(this.effectiveRenderScale() - this.renderScale) > 0.01) {
      this.sizeCanvases();
      this.renderPaper();
      this.renderInk();
      this.clearLive();
    }
    this.clampCamera();
    this.applyCamera();
  }

  private clampCamera(): void {
    const vw = this.container.clientWidth || 800;
    const vh = this.container.clientHeight || 600;
    const s = this.camera.scale;
    const pageW = PAGE_WIDTH * s;
    const pageH = PAGE_HEIGHT * s;
    const edge = 60;

    this.camera.x = pageW <= vw ? (vw - pageW) / 2 : Math.min(vw - edge, Math.max(edge - pageW, this.camera.x));
    this.camera.y = pageH <= vh ? (vh - pageH) / 2 : Math.min(vh - edge, Math.max(edge - pageH, this.camera.y));
  }

  /** Re-render canvases at the new resolution after a zoom gesture settles. */
  private scheduleZoomRefresh(): void {
    if (this.zoomEndTimer) clearTimeout(this.zoomEndTimer);
    this.zoomEndTimer = setTimeout(() => {
      this.zoomEndTimer = null;
      if (this.disposed) return;
      if (Math.abs(this.effectiveRenderScale() - this.renderScale) > 0.01) {
        this.sizeCanvases();
        this.renderPaper();
        this.renderInk();
        this.redrawLive();
      }
    }, 220);
  }

  /* ================================= camera API ================================= */

  fitWidth(): void {
    const vw = this.container.clientWidth || 800;
    this.camera.scale = Math.max(0.3, Math.min(8, (vw - 48) / PAGE_WIDTH));
    this.clampCamera();
    this.camera.y = Math.max(this.camera.y, 20);
    this.applyCamera();
    this.scheduleZoomRefresh();
  }

  zoomBy(factor: number): void {
    const vw = this.container.clientWidth || 800;
    const vh = this.container.clientHeight || 600;
    this.zoomAt(factor, vw / 2, vh / 2);
  }

  private zoomAt(factor: number, cx: number, cy: number): void {
    const oldScale = this.camera.scale;
    const newScale = Math.max(0.3, Math.min(8, oldScale * factor));
    if (newScale === oldScale) return;
    const pageX = (cx - this.camera.x) / oldScale;
    const pageY = (cy - this.camera.y) / oldScale;
    this.camera.scale = newScale;
    this.camera.x = cx - pageX * newScale;
    this.camera.y = cy - pageY * newScale;
    this.clampCamera();
    this.applyCamera();
    this.scheduleZoomRefresh();
  }

  /* ================================== history ================================== */

  private pushOp(op: HistoryOp): void {
    this.undoStack.push(op);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.notifyHistory();
    this.opts.onContentChanged?.();
  }

  private applyOp(op: HistoryOp, direction: "undo" | "redo"): void {
    const ids = (list: PageElement[]) => new Set(list.map((el) => el.id));
    const remove = (list: PageElement[]) => {
      const set = ids(list);
      this.elements = this.elements.filter((el) => !set.has(el.id));
    };
    const add = (list: PageElement[]) => {
      this.elements.push(...list.map(cloneElement));
    };
    if (op.type === "add") {
      if (direction === "undo") remove(op.elements);
      else add(op.elements);
    } else if (op.type === "remove") {
      if (direction === "undo") add(op.elements);
      else remove(op.elements);
    } else {
      if (direction === "undo") {
        remove(op.after);
        add(op.before);
      } else {
        remove(op.before);
        add(op.after);
      }
    }
    if (this.pruneSelection()) this.notifySelection();
    this.renderInk();
    this.redrawLive();
    this.opts.onContentChanged?.();
  }

  undo(): void {
    const op = this.undoStack.pop();
    if (!op) return;
    this.applyOp(op, "undo");
    this.redoStack.push(op);
    this.notifyHistory();
  }

  redo(): void {
    const op = this.redoStack.pop();
    if (!op) return;
    this.applyOp(op, "redo");
    this.undoStack.push(op);
    this.notifyHistory();
  }

  clearPage(): void {
    if (this.elements.length === 0) return;
    this.clearSelection();
    const removed = this.elements;
    this.elements = [];
    this.renderInk();
    this.redrawLive();
    this.pushOp({ type: "remove", elements: removed });
  }

  private notifyHistory(): void {
    this.opts.onHistoryChanged?.(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  /* =================================== input =================================== */

  private toPage(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.stage.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * PAGE_WIDTH,
      y: ((clientY - rect.top) / rect.height) * PAGE_HEIGHT,
    };
  }

  private trackPointer(e: PointerEvent): PointerInfo {
    const page = this.toPage(e.clientX, e.clientY);
    const info: PointerInfo = {
      clientX: e.clientX,
      clientY: e.clientY,
      pageX: page.x,
      pageY: page.y,
      type: e.pointerType,
    };
    this.pointers.set(e.pointerId, info);
    return info;
  }

  private inksWith(type: string, tool: ToolId): boolean {
    if (type !== "pen" && type !== "mouse" && type !== "touch") return false;
    const inkTool = tool === "pen" || tool === "highlighter" || tool === "shape";
    if (type === "touch") return this.fingerDrawing && inkTool;
    return inkTool;
  }

  private lasersWith(type: string, tool: ToolId): boolean {
    if (tool !== "laser") return false;
    if (type === "touch") return this.fingerDrawing;
    return type === "pen" || type === "mouse";
  }

  private erasesWith(type: string, tool: ToolId): boolean {
    const isEraser = tool === "eraser-precise" || tool === "eraser-stroke";
    if (!isEraser) return false;
    return type === "pen" || type === "mouse";
  }

  private attachesListeners(): void {
    this.stage.addEventListener("pointerdown", this.onPointerDown);
    this.stage.addEventListener("pointermove", this.onPointerMove);
    this.stage.addEventListener("pointerup", this.onPointerUp);
    this.stage.addEventListener("pointercancel", this.onPointerUp);
    this.stage.addEventListener("contextmenu", this.onContextMenu);
    this.container.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private attachListeners(): void {
    this.attachesListeners();
  }

  private detachListeners(): void {
    this.stage.removeEventListener("pointerdown", this.onPointerDown);
    this.stage.removeEventListener("pointermove", this.onPointerMove);
    this.stage.removeEventListener("pointerup", this.onPointerUp);
    this.stage.removeEventListener("pointercancel", this.onPointerUp);
    this.stage.removeEventListener("contextmenu", this.onContextMenu);
    this.container.removeEventListener("wheel", this.onWheel);
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = this.container.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 1.08 : 1 / 1.08, e.clientX - rect.left, e.clientY - rect.top);
    } else {
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      this.camera.x -= dx;
      this.camera.y -= dy;
      this.clampCamera();
      this.applyCamera();
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // primary button / pen tip only
    const type = e.pointerType;

    // Palm rejection: while a stylus is in use, touch is dead weight.
    if (this.palmRejection && type === "touch" && this.penDown) return;

    const info = this.trackPointer(e);
    if (type === "pen") {
      this.penDown = true;
      this.hoverPoint = null;
    }

    try {
      this.stage.setPointerCapture(e.pointerId);
    } catch {
      /* detached target — ignore */
    }

    // A stylus always takes priority over an in-progress finger gesture.
    if (
      (this.mode === "draw" || this.mode === "laser" || this.mode === "lasso" || this.mode === "gesture") &&
      type === "pen"
    ) {
      this.cancelActiveStroke();
      this.mode = "idle";
    }
    // A second finger joins an in-progress gesture → pinch/pan.
    if (
      (this.mode === "draw" || this.mode === "laser" || this.mode === "lasso" || this.mode === "gesture") &&
      type === "touch" &&
      e.pointerId !== this.activePointerId
    ) {
      if (this.mode === "draw" || this.mode === "laser" || this.mode === "lasso") this.cancelActiveStroke();
      if (this.mode === "gesture") this.restoreGesture(); // cancel uncommitted drag
      this.mode = "pan";
      this.lastPanScreen = null;
      if (this.pointers.size >= 2) this.initGestureAnchor();
      return;
    }

    if (this.mode !== "idle") return; // gesture already owned by another pointer

    if (this.inksWith(type, this.tool) || this.lasersWith(type, this.tool)) {
      this.activePointerId = e.pointerId;
      if (this.tool === "laser") {
        this.mode = "laser";
        this.laserTrail = [];
        this.laserTrail.push({ x: info.pageX, y: info.pageY, p: 1, t: performance.now() });
        this.startLaserLoop();
      } else {
        this.mode = "draw";
        this.beginStroke(info, e);
      }
      return;
    }

    if (this.erasesWith(type, this.tool)) {
      this.activePointerId = e.pointerId;
      this.mode = "erase";
      this.erasedOriginals.clear();
      this.createdSubs.clear();
      this.removedStrokes.clear();
      this.eraseAt(info.pageX, info.pageY);
      return;
    }

    if (this.tool === "text") {
      // Cancel the compatibility mouse events: the text editor mounts and
      // focuses synchronously during this gesture, and the browser's
      // default mousedown handling would immediately steal its focus.
      e.preventDefault();
      this.handleTextPointerDown(info, e);
      return;
    }

    if (this.tool === "lasso") {
      this.handleLassoPointerDown(info, e);
      return;
    }

    // everything else pans (single touch when finger drawing is off,
    // touch while an eraser tool is selected, etc.)
    this.mode = "pan";
    this.lastPanScreen = { x: info.clientX, y: info.clientY };
    if (this.pointers.size >= 2) this.initGestureAnchor();
  };

  private initGestureAnchor(): void {
    const pts = [...this.pointers.values()].slice(0, 2);
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    const midX = (a.clientX + b.clientX) / 2;
    const midY = (a.clientY + b.clientY) / 2;
    const rect = this.container.getBoundingClientRect();
    this.gestureAnchor = {
      dist,
      scale: this.camera.scale,
      midX: midX - rect.left,
      midY: midY - rect.top,
      pageX: (midX - rect.left - this.camera.x) / this.camera.scale,
      pageY: (midY - rect.top - this.camera.y) / this.camera.scale,
    };
  }

  private onPointerMove = (e: PointerEvent): void => {
    // Apple Pencil hover preview (iPadOS 17+)
    if (e.pointerType === "pen" && e.buttons === 0 && !this.penDown) {
      const page = this.toPage(e.clientX, e.clientY);
      this.hoverPoint = page;
      this.drawHoverPreview();
      return;
    }

    const info = this.pointers.get(e.pointerId);
    if (!info) return;
    const page = this.toPage(e.clientX, e.clientY);
    info.clientX = e.clientX;
    info.clientY = e.clientY;
    info.pageX = page.x;
    info.pageY = page.y;

    if (this.mode === "pan") {
      if (this.pointers.size >= 2 && this.gestureAnchor) {
        const pts = [...this.pointers.values()].slice(0, 2);
        const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY) || 1;
        const rect = this.container.getBoundingClientRect();
        const midX = (pts[0].clientX + pts[1].clientX) / 2 - rect.left;
        const midY = (pts[0].clientY + pts[1].clientY) / 2 - rect.top;
        const newScale = Math.max(0.3, Math.min(8, this.gestureAnchor.scale * (dist / this.gestureAnchor.dist)));
        this.camera.scale = newScale;
        this.camera.x = midX - this.gestureAnchor.pageX * newScale;
        this.camera.y = midY - this.gestureAnchor.pageY * newScale;
        this.clampCamera();
        this.applyCamera();
        this.scheduleZoomRefresh();
      } else if (this.lastPanScreen) {
        this.camera.x += e.clientX - this.lastPanScreen.x;
        this.camera.y += e.clientY - this.lastPanScreen.y;
        this.lastPanScreen = { x: e.clientX, y: e.clientY };
        this.clampCamera();
        this.applyCamera();
      }
      return;
    }

    if (e.pointerId !== this.activePointerId) return;

    if (this.mode === "draw") {
      const events =
        typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : ([] as PointerEvent[]);
      const list = events.length ? events : [e];
      for (const ce of list) {
        const p = this.toPage(ce.clientX, ce.clientY);
        this.appendStrokePoint(p, ce as PointerEvent);
      }
      this.scheduleLiveDraw();
      return;
    }

    if (this.mode === "erase") {
      this.eraseAt(page.x, page.y);
      return;
    }

    if (this.mode === "laser") {
      this.laserTrail.push({ x: page.x, y: page.y, p: 1, t: performance.now() });
      if (this.laserTrail.length > 400) this.laserTrail.shift();
      return;
    }

    if (this.mode === "lasso") {
      const last = this.lassoPts[this.lassoPts.length - 1];
      const minDist = 2 / this.camera.scale;
      if (!last || Math.hypot(page.x - last.x, page.y - last.y) > minDist) {
        this.lassoPts.push({ x: page.x, y: page.y, p: 1, t: performance.now() });
      }
      this.redrawLive();
      return;
    }

    if (this.mode === "gesture") {
      this.updateGesture(page);
      return;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const had = this.pointers.delete(e.pointerId);
    if (e.pointerType === "pen") this.penDown = false;
    if (!had) return;

    if (e.pointerId === this.activePointerId) {
      this.activePointerId = null;
      if (this.mode === "draw") {
        this.commitStroke();
        this.mode = "idle";
        return;
      }
      if (this.mode === "erase") {
        this.finishErase();
        this.mode = "idle";
        this.clearLive();
        if (this.selection.size > 0) this.redrawLive();
        return;
      }
      if (this.mode === "laser") {
        this.mode = "idle";
        return; // trail keeps fading in the laser loop
      }
      if (this.mode === "lasso") {
        this.finishLasso();
        this.mode = "idle";
        return;
      }
      if (this.mode === "gesture") {
        this.endGesture();
        this.mode = "idle";
        return;
      }
    }

    if (this.mode === "pan") {
      if (this.pointers.size === 1) {
        const remaining = [...this.pointers.values()][0];
        this.lastPanScreen = { x: remaining.clientX, y: remaining.clientY };
        this.gestureAnchor = null;
      } else if (this.pointers.size === 0) {
        this.lastPanScreen = null;
        this.gestureAnchor = null;
        this.mode = "idle";
      } else {
        this.initGestureAnchor();
      }
    }
  };

  /* ----------------------------------- strokes ----------------------------------- */

  private beginStroke(info: PointerInfo, e: PointerEvent): void {
    const isPen = e.pointerType === "pen";
    const pressure = isPen && e.pressure > 0 ? e.pressure : 0.5;
    this.lastPressure = pressure;
    const point: InkPoint = { x: info.pageX, y: info.pageY, p: pressure, t: performance.now() };
    this.currentStroke = {
      id: uid("st"),
      tool: this.tool === "highlighter" ? "highlighter" : "pen",
      color: this.tool === "highlighter" ? this.highlighterColor : this.penColor,
      size: this.tool === "highlighter" ? this.highlighterSize : this.penSize,
      points: [point],
      hasRealPressure: isPen,
    };
    this.lastPoint = point;
    this.scheduleLiveDraw();
  }

  /** Velocity-based pressure simulation for mouse / finger input. */
  private simulatedPressure(from: InkPoint, to: { x: number; y: number }): number {
    const dt = Math.max(1, performance.now() - from.t);
    const speed = Math.hypot(to.x - from.x, to.y - from.y) / dt;
    const target = Math.max(0.32, Math.min(1, 1.18 - speed * 0.55));
    return this.lastPressure + (target - this.lastPressure) * 0.22;
  }

  private appendStrokePoint(pos: { x: number; y: number }, e: PointerEvent): void {
    const stroke = this.currentStroke;
    if (!stroke || !this.lastPoint) return;
    const dx = pos.x - this.lastPoint.x;
    const dy = pos.y - this.lastPoint.y;
    if (dx * dx + dy * dy < 0.02) return;

    let pressure: number;
    if (stroke.hasRealPressure && e.pointerType === "pen" && e.pressure > 0) {
      pressure = e.pressure;
    } else {
      pressure = this.simulatedPressure(this.lastPoint, pos);
    }
    this.lastPressure = pressure;
    const point: InkPoint = { x: pos.x, y: pos.y, p: pressure, t: performance.now() };
    stroke.points.push(point);
    this.lastPoint = point;
  }

  private scheduleLiveDraw(): void {
    this.liveDirty = true;
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (this.disposed) return;
      if (this.liveDirty && this.currentStroke) {
        this.liveDirty = false;
        this.clearLive();
        drawStroke(this.liveCtx, this.currentStroke, false);
      }
    });
  }

  private cancelActiveStroke(): void {
    this.currentStroke = null;
    this.lastPoint = null;
    this.lassoPts = [];
    this.restoreGesture();
    this.activePointerId = null;
    this.clearLive();
  }

  private commitStroke(): void {
    const stroke = this.currentStroke;
    this.currentStroke = null;
    this.lastPoint = null;
    this.clearLive();
    if (!stroke || stroke.points.length === 0) return;

    let final: PageElement = stroke;
    if (this.tool === "shape") {
      const rec = recognizeShape(stroke.points);
      if (rec) {
        // resample so the outline engine keeps edges straight
        const dense = densifyPolyline(rec.points, 6);
        final = {
          id: uid("st"),
          tool: "pen",
          color: stroke.color,
          size: stroke.size,
          hasRealPressure: false,
          points: dense.map((p, i) => ({
            x: p.x,
            y: p.y,
            p: 0.62,
            t: stroke.points[0].t + i,
          })),
        };
      }
    }

    this.elements.push(final);
    if (isStroke(final)) drawStroke(this.inkCtx, final, true);
    this.pushOp({ type: "add", elements: [final] });
  }

  /* ------------------------------------ text ------------------------------------- */

  private handleTextPointerDown(info: PointerInfo, e: PointerEvent): void {
    const hit = this.textAt(info.pageX, info.pageY);
    if (hit) {
      // drag to move, tap to edit
      this.gestureKind = "textdrag";
      this.gestureOriginals.set(hit.id, cloneElement(hit));
      this.gestureStart = { x: info.pageX, y: info.pageY };
      this.gestureMoved = false;
      this.activePointerId = e.pointerId;
      this.mode = "gesture";
    } else {
      const el = this.createTextAt(info.pageX, info.pageY);
      this.beginTextEdit(el, true);
    }
  }

  private textAt(x: number, y: number): TextElement | null {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (!isText(el)) continue;
      const b = elementBounds(el);
      const pad = 10;
      if (x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad) {
        return el;
      }
    }
    return null;
  }

  private createTextAt(x: number, y: number): TextElement {
    const fontSize = this.textSize;
    const width = Math.min(620, PAGE_WIDTH - 48);
    const el: TextElement = {
      kind: "text",
      id: uid("tx"),
      x: Math.max(12, Math.min(PAGE_WIDTH - width - 12, x)),
      y: Math.max(12, Math.min(PAGE_HEIGHT - fontSize * 2, y - fontSize * 0.7)),
      width,
      text: "",
      fontSize,
      color: this.penColor,
    };
    this.elements.push(el);
    return el;
  }

  private beginTextEdit(el: TextElement, isNew: boolean): void {
    this.textEditId = el.id;
    this.editOriginal = cloneElement(el);
    this.editIsNew = isNew;
    this.opts.onTextEditStart?.(el, isNew);
  }

  /** Commit (or discard) the text box currently being edited by the host. */
  commitTextEdit(id: string, text: string): void {
    if (this.textEditId !== id) return;
    const el = this.elements.find((e): e is TextElement => isText(e) && e.id === id);
    this.textEditId = null;
    const original = this.editOriginal;
    this.editOriginal = null;
    if (!el) return;

    if (text.trim().length === 0) {
      // empty box → discard / delete
      this.elements = this.elements.filter((e) => e.id !== id);
      if (!this.editIsNew && original) {
        this.pushOp({ type: "remove", elements: [original] });
      }
      this.renderInk();
      this.redrawLive();
      return;
    }

    el.text = text;
    if (this.editIsNew) {
      this.pushOp({ type: "add", elements: [el] });
    } else if (original) {
      this.pushOp({ type: "replace", before: [original], after: [cloneElement(el)] });
    }
    this.renderInk();
    this.redrawLive();
  }

  /* ------------------------------------ lasso ------------------------------------ */

  private handleLassoPointerDown(info: PointerInfo, e: PointerEvent): void {
    const p = { x: info.pageX, y: info.pageY };

    // resize handle on a single selected image?
    if (this.selection.size === 1) {
      const el = this.elements.find((item): item is ImageElement => {
        if (!isImage(item)) return false;
        return this.selection.has(item.id);
      });
      if (el) {
        const hx = el.x + el.width;
        const hy = el.y + el.height;
        const r = 14 / this.camera.scale;
        if (Math.hypot(p.x - hx, p.y - hy) <= r) {
          this.beginGesture("resize", p, e.pointerId);
          return;
        }
      }
    }

    // drag inside the current selection moves it
    if (this.selection.size > 0) {
      const b = this.selectionBounds();
      const pad = 8 / this.camera.scale;
      if (b && p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad) {
        // clicking a non-selected element while a selection exists re-targets it
        const hitStroke = this.elements.find(
          (item) => !this.selection.has(item.id) && this.elementHit(item, p.x, p.y)
        );
        if (hitStroke) {
          this.clearSelection();
        } else {
          this.beginGesture("move", p, e.pointerId);
          return;
        }
      }
    }

    this.mode = "lasso";
    this.activePointerId = e.pointerId;
    this.lassoPts = [{ x: p.x, y: p.y, p: 1, t: performance.now() }];
    this.redrawLive();
  }

  private elementHit(el: PageElement, x: number, y: number): boolean {
    if (isStroke(el)) return strokeHit(el, x, y, 8 / this.camera.scale);
    const b = elementBounds(el);
    return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  }

  private finishLasso(): void {
    const pts = this.lassoPts;
    this.lassoPts = [];
    let pathLen = 0;
    for (let i = 1; i < pts.length; i++) {
      pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (pathLen < 14) {
      // a tap on empty space clears the selection
      this.clearSelection();
      return;
    }
    const hits = elementsInPolygon(this.elements, pts);
    this.selection = new Set(hits);
    this.notifySelection();
    this.redrawLive();
  }

  private selectionBounds() {
    const list: ReturnType<typeof elementBounds>[] = [];
    for (const el of this.elements) {
      if (this.selection.has(el.id)) list.push(elementBounds(el));
    }
    return unionBounds(list);
  }

  /* ------------------------- move / resize / text-drag ------------------------- */

  private beginGesture(kind: GestureKind, page: { x: number; y: number }, pointerId: number): void {
    this.gestureKind = kind;
    this.gestureOriginals.clear();
    if (kind === "textdrag") {
      // originals already set by handleTextPointerDown
    } else {
      for (const el of this.elements) {
        if (this.selection.has(el.id)) this.gestureOriginals.set(el.id, cloneElement(el));
      }
    }
    this.gestureStart = { x: page.x, y: page.y };
    this.gestureMoved = false;
    this.activePointerId = pointerId;
    this.mode = "gesture";
  }

  private updateGesture(page: { x: number; y: number }): void {
    const dx = page.x - this.gestureStart.x;
    const dy = page.y - this.gestureStart.y;
    const threshold = 3 / this.camera.scale;
    if (!this.gestureMoved && Math.hypot(dx, dy) > threshold) this.gestureMoved = true;
    if (!this.gestureMoved) return;

    for (const [id, orig] of this.gestureOriginals) {
      const el = this.elements.find((item) => item.id === id);
      if (!el) continue;
      const copy = cloneElement(orig);
      if (this.gestureKind === "resize" && isImage(copy) && isImage(orig)) {
        copy.width = Math.max(32, orig.width + dx);
        copy.height = Math.max(32, orig.height + dy);
      } else {
        translateElement(copy, dx, dy);
      }
      Object.assign(el, copy);
    }
    this.renderInk();
    this.redrawLive();
  }

  private restoreGesture(): void {
    if (this.gestureOriginals.size === 0) return;
    for (const [id, orig] of this.gestureOriginals) {
      const idx = this.elements.findIndex((item) => item.id === id);
      if (idx >= 0) this.elements[idx] = cloneElement(orig);
    }
    this.gestureOriginals.clear();
    this.renderInk();
    this.redrawLive();
  }

  private endGesture(): void {
    const moved = this.gestureMoved;
    const kind = this.gestureKind;
    const originals = [...this.gestureOriginals.values()];
    this.gestureOriginals.clear();

    if (kind === "textdrag" && !moved) {
      const id = originals[0]?.id;
      const el = this.elements.find((item): item is TextElement => isText(item) && item.id === id);
      this.gestureMoved = false;
      this.mode = "idle";
      if (el) this.beginTextEdit(el, false);
      return;
    }

    this.gestureMoved = false;
    this.mode = "idle";
    if (!moved || originals.length === 0) {
      this.renderInk();
      this.redrawLive();
      return;
    }
    const after = this.elements
      .filter((el) => originals.some((o) => o.id === el.id))
      .map(cloneElement);
    this.pushOp({ type: "replace", before: originals, after });
  }

  /* --------------------------------- selection ---------------------------------- */

  clearSelection(): void {
    if (this.textEditId) return; // don't clear while the host edits a text box
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.notifySelection();
    this.redrawLive();
  }

  selectOnly(id: string): void {
    this.selection = new Set([id]);
    this.notifySelection();
    this.redrawLive();
  }

  private pruneSelection(): boolean {
    const ids = new Set(this.elements.map((el) => el.id));
    const next = new Set([...this.selection].filter((id) => ids.has(id)));
    if (next.size === this.selection.size) return false;
    this.selection = next;
    return true;
  }

  private notifySelection(): void {
    this.opts.onSelectionChanged?.(this.selection.size > 0);
  }

  deleteSelection(): void {
    if (this.selection.size === 0) return;
    const removed = this.elements.filter((el) => this.selection.has(el.id));
    this.elements = this.elements.filter((el) => !this.selection.has(el.id));
    this.selection.clear();
    this.renderInk();
    this.redrawLive();
    this.notifySelection();
    this.pushOp({ type: "remove", elements: removed });
  }

  duplicateSelection(): void {
    if (this.selection.size === 0) return;
    const clones = this.elements
      .filter((el) => this.selection.has(el.id))
      .map((el) => {
        const copy = cloneElement(el);
        copy.id = uid(el.kind === "text" ? "tx" : el.kind === "image" ? "im" : "st");
        translateElement(copy, 18, 18);
        return copy;
      });
    this.elements.push(...clones);
    this.selection = new Set(clones.map((c) => c.id));
    this.renderInk();
    this.redrawLive();
    this.notifySelection();
    this.pushOp({ type: "add", elements: clones });
  }

  /** Screen-space (container px) rect around the selection, for floating UI. */
  getSelectionScreenRect(): { left: number; top: number; width: number; height: number } | null {
    const b = this.selectionBounds();
    if (!b) return null;
    const s = this.camera.scale;
    return {
      left: this.camera.x + b.minX * s,
      top: this.camera.y + b.minY * s,
      width: (b.maxX - b.minX) * s,
      height: (b.maxY - b.minY) * s,
    };
  }

  /* ----------------------------------- images ------------------------------------ */

  /** Insert an image fitted around the current viewport centre. */
  addImageElement(src: string, naturalW: number, naturalH: number): string {
    const vw = this.container.clientWidth || 800;
    const vh = this.container.clientHeight || 600;
    const cx = (vw / 2 - this.camera.x) / this.camera.scale;
    const cy = (vh / 2 - this.camera.y) / this.camera.scale;
    const maxW = PAGE_WIDTH * 0.6;
    const maxH = PAGE_HEIGHT * 0.6;
    const fit = Math.min(1, maxW / naturalW, maxH / naturalH);
    const w = naturalW * fit;
    const h = naturalH * fit;
    const el: ImageElement = {
      kind: "image",
      id: uid("im"),
      x: Math.max(8, Math.min(PAGE_WIDTH - w - 8, cx - w / 2)),
      y: Math.max(8, Math.min(PAGE_HEIGHT - h - 8, cy - h / 2)),
      width: w,
      height: h,
      src,
    };
    this.elements.push(el);
    this.renderInk();
    this.selectOnly(el.id);
    this.pushOp({ type: "add", elements: [el] });
    return el.id;
  }

  /* ----------------------------------- eraser ------------------------------------ */

  private eraseAt(x: number, y: number): void {
    const r = this.eraserSize / 2;
    let changed = false;

    if (this.tool === "eraser-stroke") {
      for (let i = this.elements.length - 1; i >= 0; i--) {
        const el = this.elements[i];
        if (!isStroke(el)) continue;
        if (strokeHit(el, x, y, r)) {
          this.removedStrokes.set(el.id, el);
          this.elements.splice(i, 1);
          changed = true;
        }
      }
    } else {
      for (let i = this.elements.length - 1; i >= 0; i--) {
        const el = this.elements[i];
        if (!isStroke(el)) continue;
        if (!strokeHit(el, x, y, r)) continue;
        const subs = eraseStrokePrecise(el, x, y, r, () => uid("st"));
        this.elements.splice(i, 1, ...subs);
        this.erasedOriginals.set(el.id, el);
        for (const sub of subs) this.createdSubs.set(sub.id, sub);
        changed = true;
      }
    }
    if (changed) {
      if (this.pruneSelection()) this.notifySelection();
      this.renderInk();
    }

    // eraser cursor ring (drawn in page space so it scales with zoom)
    this.clearLive();
    const ctx = this.liveCtx;
    ctx.save();
    ctx.strokeStyle = "rgba(31,27,22,0.5)";
    ctx.lineWidth = 1.5 / this.camera.scale;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(r, 2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private finishErase(): void {
    if (this.tool === "eraser-stroke") {
      if (this.removedStrokes.size > 0) {
        this.pushOp({
          type: "remove",
          elements: [...this.removedStrokes.values()].map((s) => ({ ...s, kind: "stroke" as const })),
        });
      }
    } else if (this.erasedOriginals.size > 0) {
      this.pushOp({
        type: "replace",
        before: [...this.erasedOriginals.values()].map((s) => ({ ...s, kind: "stroke" as const })),
        after: [...this.createdSubs.values()].map((s) => ({ ...s, kind: "stroke" as const })),
      });
    }
    this.erasedOriginals.clear();
    this.createdSubs.clear();
    this.removedStrokes.clear();
  }

  /* ------------------------------------ laser ------------------------------------ */

  private startLaserLoop(): void {
    if (this.laserRunning) return;
    this.laserRunning = true;
    const loop = () => {
      if (this.disposed) {
        this.laserRunning = false;
        return;
      }
      const now = performance.now();
      this.laserTrail = this.laserTrail.filter((pt) => now - pt.t < LASER_LIFE_MS);
      this.clearLive();

      if (this.laserTrail.length > 0) {
        const ctx = this.liveCtx;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#ff4d3a";
        for (let i = 1; i < this.laserTrail.length; i++) {
          const a = this.laserTrail[i - 1];
          const b = this.laserTrail[i];
          const age = (now - b.t) / LASER_LIFE_MS;
          ctx.globalAlpha = Math.max(0, 1 - age) * 0.9;
          ctx.lineWidth = 2 + 7 * (1 - age);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        const head = this.laserTrail[this.laserTrail.length - 1];
        ctx.globalAlpha = 1;
        ctx.shadowColor = "rgba(255,77,58,0.9)";
        ctx.shadowBlur = 16 / this.camera.scale;
        ctx.fillStyle = "#ff6a58";
        ctx.beginPath();
        ctx.arc(head.x, head.y, 4.5 / this.camera.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        requestAnimationFrame(loop);
      } else {
        this.laserRunning = false;
        if (this.mode !== "laser") this.clearLive();
      }
    };
    requestAnimationFrame(loop);
  }

  /* --------------------------- selection & lasso overlay --------------------------- */

  /** Repaint the live layer: selection bboxes, handles, active lasso loop. */
  private redrawLive(): void {
    this.clearLive();
    const ctx = this.liveCtx;
    const s = this.camera.scale;
    const lw = 1.4 / s;
    ctx.save();
    ctx.strokeStyle = "#c9973b";
    ctx.lineWidth = lw;
    ctx.setLineDash([6 / s, 4 / s]);

    for (const el of this.elements) {
      if (!this.selection.has(el.id)) continue;
      const b = elementBounds(el);
      ctx.strokeRect(b.minX - 4 / s, b.minY - 4 / s, b.maxX - b.minX + 8 / s, b.maxY - b.minY + 8 / s);
    }
    ctx.setLineDash([]);

    // corner resize handle when exactly one image is selected
    if (this.selection.size === 1) {
      const img = this.elements.find((el): el is ImageElement => isImage(el) && this.selection.has(el.id));
      if (img) {
        const hx = img.x + img.width;
        const hy = img.y + img.height;
        const r = 7 / s;
        ctx.fillStyle = "#c9973b";
        ctx.strokeStyle = "#fffdf7";
        ctx.lineWidth = 1.6 / s;
        ctx.beginPath();
        ctx.rect(hx - r, hy - r, r * 2, r * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // active lasso loop
    if (this.mode === "lasso" && this.lassoPts.length > 1) {
      ctx.strokeStyle = "rgba(90,74,53,0.85)";
      ctx.lineWidth = 1.6 / s;
      ctx.setLineDash([5 / s, 4 / s]);
      ctx.beginPath();
      ctx.moveTo(this.lassoPts[0].x, this.lassoPts[0].y);
      for (const pt of this.lassoPts) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* -------------------------------- hover previews ------------------------------- */

  private drawHoverPreview(): void {
    this.clearLive();
    if (!this.hoverPoint) return;
    if (this.selection.size > 0) this.drawSelectionOverlayOnly();
    const ctx = this.liveCtx;
    const { x, y } = this.hoverPoint;
    ctx.save();
    if (this.tool === "eraser-precise" || this.tool === "eraser-stroke") {
      ctx.strokeStyle = "rgba(31,27,22,0.45)";
      ctx.lineWidth = 1.2 / this.camera.scale;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(this.eraserSize / 2, 2), 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.tool === "pen" || this.tool === "highlighter" || this.tool === "shape") {
      const size = this.tool === "pen" || this.tool === "shape" ? this.penSize : this.highlighterSize;
      ctx.strokeStyle = "rgba(31,27,22,0.35)";
      ctx.lineWidth = 1.2 / this.camera.scale;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(size / 2, 1.5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSelectionOverlayOnly(): void {
    const ctx = this.liveCtx;
    const s = this.camera.scale;
    ctx.save();
    ctx.strokeStyle = "#c9973b";
    ctx.lineWidth = 1.4 / s;
    ctx.setLineDash([6 / s, 4 / s]);
    for (const el of this.elements) {
      if (!this.selection.has(el.id)) continue;
      const b = elementBounds(el);
      ctx.strokeRect(b.minX - 4 / s, b.minY - 4 / s, b.maxX - b.minX + 8 / s, b.maxY - b.minY + 8 / s);
    }
    ctx.restore();
  }

  /* ----------------------------------- export ------------------------------------ */

  /** Compose paper + background + content into a PNG blob (1 = page units). */
  async exportPngBlob(pixelScale = 2): Promise<Blob | null> {
    const c = document.createElement("canvas");
    await renderPage(c, {
      template: this.template,
      elements: this.elements,
      background: this.background ?? undefined,
    }, pixelScale);
    return new Promise((resolve) => c.toBlob((blob) => resolve(blob), "image/png"));
  }
}
