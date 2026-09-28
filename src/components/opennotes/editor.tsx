"use client";
/**
 * Notebook editor: hosts the InkEngine canvas stack, the tool rail and
 * page management. Handles autosave, keyboard shortcuts and export.
 * Adds text-box editing, selection actions, page overview and bookmarks.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Ellipsis,
  ZoomIn,
  ZoomOut,
  Scan,
  Loader2,
  Star,
  LayoutGrid,
  Copy,
  Trash2,
  X,
} from "lucide-react";
import { InkEngine } from "./ink-engine";
import { Toolbar, type ToolState } from "./toolbar";
import { useOpenNotes } from "@/lib/opennotes/store";
import * as db from "@/lib/opennotes/db";
import { PAPER_TEMPLATES } from "@/lib/opennotes/paper";
import { downloadBlob, exportNotebookPdf } from "@/lib/opennotes/export";
import { loadImage, renderPage } from "@/lib/opennotes/render";
import { TEXT_LINE_HEIGHT } from "@/lib/opennotes/ink";
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TEXT_FONT_STACK,
  uid,
  type PageData,
  type PaperTemplate,
  type TextElement,
  type ToolId,
} from "@/lib/opennotes/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";

type SaveState = "idle" | "saving" | "saved";

interface EditingText {
  id: string;
  value: string;
  el: TextElement;
}

interface SelChip {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function EditorView({ notebookId }: { notebookId: string }) {
  const openLibrary = useOpenNotes((s) => s.openLibrary);
  const palmRejection = useOpenNotes((s) => s.palmRejection);
  const fingerDrawing = useOpenNotes((s) => s.fingerDrawing);
  const setPalmRejection = useOpenNotes((s) => s.setPalmRejection);
  const setFingerDrawing = useOpenNotes((s) => s.setFingerDrawing);
  const refreshNotebook = useOpenNotes((s) => s.refreshNotebook);

  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<InkEngine | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("Notebook");
  const [pages, setPages] = useState<PageData[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [exporting, setExporting] = useState(false);
  const [tool, setTool] = useState<ToolId>("pen");
  const [toolState, setToolState] = useState<Omit<ToolState, "tool">>({
    penColor: "#1f1b16",
    penSize: 4,
    highlighterColor: "#ffd93d",
    highlighterSize: 22,
    eraserSize: 24,
    textSize: 28,
  });
  const [editing, setEditing] = useState<EditingText | null>(null);
  const [textH, setTextH] = useState(0);
  const [cam, setCam] = useState({ x: 0, y: 0, scale: 1 });
  const [selRect, setSelRect] = useState<SelChip | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [viewportW, setViewportW] = useState(400);

  // refs mirroring latest values for stable callbacks
  const pagesRef = useRef<PageData[]>([]);
  const pageIndexRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedForRef = useRef<InkEngine | null>(null);

  /** Push the current page into an engine instance (first load or recreation). */
  const initEnginePage = useCallback((engine: InkEngine) => {
    if (initializedForRef.current === engine) return;
    const list = pagesRef.current;
    if (list.length === 0) return;
    initializedForRef.current = engine;
    const p = list[0];
    engine.setPage(p.template, p.elements, p.background);
    engine.fitWidth();
  }, []);

  const safeTitle = useCallback(
    () => title.replace(/[^\w\d-]+/g, "-").replace(/^-+|-+$/g, "") || "notebook",
    [title]
  );

  const updateSelectionUi = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const rect = engine.getSelectionScreenRect();
    setHasSelection(rect !== null);
    setSelRect(rect);
    setViewportW(viewportRef.current?.clientWidth ?? 400);
  }, []);

  /* --------------------------------- autosave -------------------------------- */
  const savePage = useCallback(
    async (index: number) => {
      const engine = engineRef.current;
      const page = pagesRef.current[index];
      if (!engine || !page) return;
      // an engine that never received the page (still loading / recreated)
      // must never overwrite stored content with an empty element list
      if (initializedForRef.current !== engine) return;
      setSaveState("saving");
      const updated: PageData = {
        ...page,
        template: engine.getTemplate(),
        elements: engine.getElements(),
        background: engine.getBackground() ?? page.background,
        updatedAt: Date.now(),
      };
      pagesRef.current = pagesRef.current.map((p, i) => (i === index ? updated : p));
      setPages(pagesRef.current);
      await db.putPage(updated);
      const meta = (await db.listNotebooks()).find((n) => n.id === notebookId);
      if (meta) {
        await db.putNotebook({ ...meta, updatedAt: Date.now() });
      }
      setSaveState("saved");
    },
    [notebookId]
  );

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void savePage(pageIndexRef.current), 500);
  }, [savePage]);

  const flushSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (engineRef.current && pagesRef.current.length > 0) {
      void savePage(pageIndexRef.current);
    }
  }, [savePage]);

  // best-effort flush when the tab is hidden or closed mid-autosave window
  useEffect(() => {
    const flush = () => flushSave();
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, [flushSave]);

  /* ------------------------------ load notebook ------------------------------ */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, loaded] = await Promise.all([
          db.listNotebooks().then((all) => all.find((n) => n.id === notebookId)),
          db.listPages(notebookId),
        ]);
        if (cancelled) return;
        if (meta) setTitle(meta.title);
        if (loaded.length > 0) {
          pagesRef.current = loaded;
          setPages(loaded);
        }
      } catch {
        /* storage unavailable — editor still works in-memory */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notebookId]);

  /* ------------------------------ engine setup ------------------------------- */
  useEffect(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    const paper = paperRef.current;
    const ink = inkRef.current;
    const live = liveRef.current;
    if (!viewport || !stage || !paper || !ink || !live) return;

    const engine = new InkEngine(
      viewport,
      stage,
      { paper, ink, live },
      {
        onHistoryChanged: (u, r) => {
          setCanUndo(u);
          setCanRedo(r);
        },
        onCameraChanged: (scale) => {
          setZoom(scale);
          setCam(engine.getCamera());
          updateSelectionUi();
        },
        onContentChanged: () => scheduleSave(),
        onSelectionChanged: () => updateSelectionUi(),
        onTextEditStart: (el) => {
          setEditing({ id: el.id, value: el.text, el: { ...el } });
        },
      }
    );
    engineRef.current = engine;
    initEnginePage(engine);
    // read settings imperatively so toggling them never re-mounts the engine
    const settings = useOpenNotes.getState();
    engine.palmRejection = settings.palmRejection;
    engine.fingerDrawing = settings.fingerDrawing;

    // iOS Safari page pinch-zoom must not fight the canvas gestures
    const blockGesture = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", blockGesture);
    document.addEventListener("gesturechange", blockGesture);

    return () => {
      document.removeEventListener("gesturestart", blockGesture);
      document.removeEventListener("gesturechange", blockGesture);
      flushSave();
      engine.destroy();
      engineRef.current = null;
    };
  }, [notebookId, scheduleSave, flushSave, updateSelectionUi, initEnginePage]);

  /* --------------------- first page load after pages arrive ------------------- */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    initEnginePage(engine);
  }, [pages, initEnginePage]);

  /* --------------------------- sync settings/tool ---------------------------- */
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.palmRejection = palmRejection;
    e.fingerDrawing = fingerDrawing;
    e.tool = tool;
    e.penColor = toolState.penColor;
    e.penSize = toolState.penSize;
    e.highlighterColor = toolState.highlighterColor;
    e.highlighterSize = toolState.highlighterSize;
    e.eraserSize = toolState.eraserSize;
    e.textSize = toolState.textSize;
  }, [tool, toolState, palmRejection, fingerDrawing]);

  // leaving the lasso tool drops any active selection
  useEffect(() => {
    if (tool !== "lasso") engineRef.current?.clearSelection();
  }, [tool]);

  // focus the text editor when a (new) text box becomes active
  const focusedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editing) {
      focusedIdRef.current = null;
      return;
    }
    if (!textareaRef.current || focusedIdRef.current === editing.id) return;
    focusedIdRef.current = editing.id;
    setTextH(0);
    const ta = textareaRef.current;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [editing]);

  const commitEditing = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !editing) return;
    engine.commitTextEdit(editing.id, editing.value);
    setEditing(null);
  }, [editing]);

  /* ------------------------------ page switching ------------------------------ */
  const goToPage = useCallback(
    (target: number) => {
      const engine = engineRef.current;
      const list = pagesRef.current;
      if (!engine || list.length === 0) return;
      const clamped = Math.max(0, Math.min(list.length - 1, target));
      if (clamped === pageIndexRef.current) return;
      commitEditing();
      void savePage(pageIndexRef.current);
      pageIndexRef.current = clamped;
      setPageIndex(clamped);
      const page = list[clamped];
      engine.setPage(page.template, page.elements, page.background);
      engine.fitWidth();
    },
    [commitEditing, savePage]
  );

  const addPage = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    commitEditing();
    void savePage(pageIndexRef.current);
    const now = Date.now();
    const page: PageData = {
      id: uid("pg"),
      notebookId,
      index: pagesRef.current.length,
      template: engine.getTemplate(),
      elements: [],
      updatedAt: now,
    };
    await db.putPage(page);
    pagesRef.current = [...pagesRef.current, page];
    setPages(pagesRef.current);
    pageIndexRef.current = pagesRef.current.length - 1;
    setPageIndex(pageIndexRef.current);
    engine.setPage(page.template, page.elements, page.background);
    engine.fitWidth();
    await refreshNotebook(notebookId, +1);
  }, [commitEditing, notebookId, refreshNotebook, savePage]);

  const deleteCurrentPage = useCallback(async () => {
    const engine = engineRef.current;
    const list = pagesRef.current;
    if (!engine) return;
    commitEditing();
    if (list.length <= 1) {
      engine.clearPage(); // a notebook always keeps at least one page
      return;
    }
    const victim = list[pageIndexRef.current];
    await db.deletePage(victim.id);
    const remaining = list.filter((p) => p.id !== victim.id).map((p, i) => ({ ...p, index: i }));
    await Promise.all(remaining.map((p) => db.putPage(p)));
    pagesRef.current = remaining;
    setPages(remaining);
    const next = Math.max(0, pageIndexRef.current - 1);
    pageIndexRef.current = next;
    setPageIndex(next);
    engine.setPage(remaining[next].template, remaining[next].elements, remaining[next].background);
    engine.fitWidth();
    await refreshNotebook(notebookId, -1);
  }, [commitEditing, notebookId, refreshNotebook]);

  const changeTemplate = useCallback(
    (t: PaperTemplate) => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.setTemplate(t);
      scheduleSave();
    },
    [scheduleSave]
  );

  /* --------------------------------- bookmarks -------------------------------- */
  const toggleBookmark = useCallback(
    async (index: number) => {
      const page = pagesRef.current[index];
      if (!page) return;
      const updated: PageData = { ...page, bookmarked: !page.bookmarked };
      pagesRef.current = pagesRef.current.map((p, i) => (i === index ? updated : p));
      setPages(pagesRef.current);
      await db.putPage(updated);
    },
    []
  );

  /* ---------------------------------- images ---------------------------------- */
  const handleImageFile = useCallback(
    async (file: File) => {
      const engine = engineRef.current;
      if (!engine) return;
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const img = await loadImage(src);
      engine.addImageElement(src, img.naturalWidth, img.naturalHeight);
      setTool("lasso"); // the new image lands selected — ready to move/resize
    },
    []
  );

  /* --------------------------------- exports --------------------------------- */
  const handleExportPng = useCallback(async () => {
    const engine = engineRef.current;
    const page = pagesRef.current[pageIndexRef.current];
    if (!engine || !page) return;
    setExporting(true);
    try {
      const blob = await engine.exportPngBlob(2);
      if (blob) downloadBlob(blob, `${safeTitle()}-page-${pageIndexRef.current + 1}.png`);
    } finally {
      setExporting(false);
    }
  }, [safeTitle]);

  const handleExportPdf = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    setExporting(true);
    try {
      commitEditing();
      // flush current page first so the PDF includes the latest ink
      await savePage(pageIndexRef.current);
      await exportNotebookPdf(pagesRef.current, `${safeTitle()}.pdf`);
    } finally {
      setExporting(false);
    }
  }, [commitEditing, safeTitle, savePage]);

  /* ----------------------------- keyboard shortcuts ---------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        target?.isContentEditable;
      if (typing) {
        if (e.key === "Escape") (target as HTMLTextAreaElement).blur();
        return; // native editing keys (incl. cmd+z) win inside inputs
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) engineRef.current?.redo();
        else engineRef.current?.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        engineRef.current?.redo();
        return;
      }
      if (mod) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (hasSelection) {
          e.preventDefault();
          engineRef.current?.deleteSelection();
        }
        return;
      }
      if (e.key === "Escape") {
        engineRef.current?.clearSelection();
        return;
      }
      switch (e.key.toLowerCase()) {
        case "p":
          setTool("pen");
          break;
        case "h":
          setTool("highlighter");
          break;
        case "e":
          setTool("eraser-precise");
          break;
        case "s":
          setTool("eraser-stroke");
          break;
        case "l":
          setTool("laser");
          break;
        case "v":
          setTool("lasso");
          break;
        case "t":
          setTool("text");
          break;
        case "r":
          setTool("shape");
          break;
        case "i":
          imageInputRef.current?.click();
          break;
        case "arrowleft":
          goToPage(pageIndexRef.current - 1);
          break;
        case "arrowright":
          goToPage(pageIndexRef.current + 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToPage, hasSelection]);

  const displayCount = Math.max(1, pages.length);
  const currentTemplate = pages[pageIndex]?.template ?? "dotted";
  const currentPage = pages[pageIndex];

  return (
    <TooltipProvider delayDuration={400}>
      <div className="relative flex h-dvh flex-col overflow-hidden bg-[#d9cfba] text-[#3b2f21]">
        {/* top bar */}
        <header
          className="z-20 flex min-h-12 shrink-0 items-center gap-1.5 bg-[#33291d] px-2 text-[#e8d9c2] shadow-md sm:px-3"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl text-[#e8d9c2] hover:bg-white/10"
            onClick={() => {
              commitEditing();
              flushSave();
              void refreshNotebook(notebookId, 0);
              openLibrary();
            }}
            aria-label="Back to library"
          >
            <ArrowLeft className="size-[18px]" />
          </Button>
          <h1 className="min-w-0 truncate text-sm font-semibold">{title}</h1>
          <SaveBadge state={saveState} />

          <div className="flex-1" />

          {exporting && <Loader2 className="size-4 animate-spin text-[#e8d9c2]" aria-label="Exporting" />}

          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl text-[#e8d9c2] hover:bg-white/10"
            onClick={() => void toggleBookmark(pageIndexRef.current)}
            aria-label={currentPage?.bookmarked ? "Remove bookmark" : "Bookmark page"}
          >
            <Star
              className={`size-[18px] ${currentPage?.bookmarked ? "fill-[#e5b32e] text-[#e5b32e]" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl text-[#e8d9c2] hover:bg-white/10"
            onClick={() => setOverviewOpen(true)}
            aria-label="Page overview"
          >
            <LayoutGrid className="size-[18px]" />
          </Button>

          <div
            className="hidden items-center gap-0.5 rounded-xl bg-white/5 p-0.5 sm:flex"
            role="group"
            aria-label="Zoom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-[#e8d9c2] hover:bg-white/10"
              onClick={() => engineRef.current?.zoomBy(1 / 1.2)}
              aria-label="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="min-w-[2.6rem] text-center text-[11px] font-semibold tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-[#e8d9c2] hover:bg-white/10"
              onClick={() => engineRef.current?.zoomBy(1.2)}
              aria-label="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-[#e8d9c2] hover:bg-white/10"
              onClick={() => engineRef.current?.fitWidth()}
              aria-label="Fit page width"
            >
              <Scan className="size-4" />
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 rounded-xl text-[#e8d9c2] hover:bg-white/10"
                aria-label="More options"
              >
                <Ellipsis className="size-[18px]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 bg-[#fffdf7]">
              <DropdownMenuLabel className="text-xs text-[#8a7457]">Paper template</DropdownMenuLabel>
              {PAPER_TEMPLATES.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => changeTemplate(t.id)}>
                  <span className="flex-1">{t.label}</span>
                  {currentTemplate === t.id && <Check className="size-4 text-[#8a5a32]" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => imageInputRef.current?.click()}>
                <span>Insert image…</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOverviewOpen(true)}>
                <span>Page overview</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void handleExportPng()}>
                <span>Export page as PNG</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleExportPdf()}>
                <span>Export notebook as PDF</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                className="items-center justify-between"
              >
                <span>Palm rejection</span>
                <Switch
                  checked={palmRejection}
                  onCheckedChange={setPalmRejection}
                  aria-label="Palm rejection"
                />
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => e.preventDefault()}
                className="items-center justify-between"
              >
                <span>Draw with finger</span>
                <Switch
                  checked={fingerDrawing}
                  onCheckedChange={setFingerDrawing}
                  aria-label="Draw with finger"
                />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 focus:text-red-700"
                onSelect={() => void deleteCurrentPage()}
              >
                <span>{pages.length > 1 ? "Delete current page" : "Clear page"}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* canvas viewport */}
        <div ref={viewportRef} className="relative flex-1 overflow-hidden">
          <div
            ref={stageRef}
            className="absolute left-0 top-0 origin-top-left will-change-transform"
            style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT }}
          >
            {/* sheet shadow */}
            <div className="absolute -inset-1 rounded-sm shadow-[0_2px_24px_rgba(60,42,20,0.35)]" aria-hidden="true" />
            <canvas ref={paperRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
            <canvas ref={inkRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
            <canvas
              ref={liveRef}
              className="absolute inset-0 h-full w-full"
              style={{ cursor: "crosshair" }}
              aria-label="Drawing canvas"
            />
          </div>

          {/* text box editor overlay */}
          {editing && (
            <textarea
              ref={textareaRef}
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onBlur={commitEditing}
              spellCheck={false}
              aria-label="Text box"
              className="absolute z-10 m-0 resize-none overflow-hidden rounded-sm border border-dashed border-[#8a5a32] bg-transparent p-0 outline-none"
              style={{
                left: cam.x + editing.el.x * cam.scale,
                top: cam.y + editing.el.y * cam.scale,
                width: editing.el.width * cam.scale,
                fontSize: editing.el.fontSize * cam.scale,
                lineHeight: TEXT_LINE_HEIGHT,
                fontFamily: TEXT_FONT_STACK,
                color: editing.el.color,
                height: textH > 0 ? textH : editing.el.fontSize * TEXT_LINE_HEIGHT * cam.scale,
              }}
              onInput={(e) => setTextH(e.currentTarget.scrollHeight)}
            />
          )}

          {/* selection action chip */}
          {hasSelection && selRect && !editing && (
            <div
              className="pointer-events-auto absolute z-10 flex items-center gap-0.5 rounded-xl border border-[#3f3226]/30 bg-[#33291d]/95 px-1 py-0.5 shadow-xl"
              style={{
                left: Math.max(8, Math.min(selRect.left + selRect.width / 2, viewportW - 80)),
                top: Math.max(44, selRect.top - 6),
                transform: "translate(-50%, -100%)",
              }}
              role="toolbar"
              aria-label="Selection actions"
            >
              <button
                onClick={() => engineRef.current?.duplicateSelection()}
                className="rounded-lg p-1.5 text-[#e8d9c2] hover:bg-white/10"
                aria-label="Duplicate selection"
              >
                <Copy className="size-4" />
              </button>
              <button
                onClick={() => engineRef.current?.deleteSelection()}
                className="rounded-lg p-1.5 text-[#e8d9c2] hover:bg-white/10 hover:text-red-400"
                aria-label="Delete selection"
              >
                <Trash2 className="size-4" />
              </button>
              <button
                onClick={() => engineRef.current?.clearSelection()}
                className="rounded-lg p-1.5 text-[#e8d9c2] hover:bg-white/10"
                aria-label="Deselect"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
        </div>

        {/* tool rail */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Toolbar
            state={{ tool, ...toolState }}
            onChange={(patch) => {
              const { tool: t, ...rest } = patch;
              if (t !== undefined) setTool(t);
              if (Object.keys(rest).length > 0) setToolState((s) => ({ ...s, ...rest }));
            }}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => engineRef.current?.undo()}
            onRedo={() => engineRef.current?.redo()}
            pageIndex={pageIndex}
            pageCount={displayCount}
            onPrevPage={() => goToPage(pageIndexRef.current - 1)}
            onNextPage={() => goToPage(pageIndexRef.current + 1)}
            onAddPage={() => void addPage()}
            onImagePick={() => imageInputRef.current?.click()}
          />
        </div>

        {/* hidden image input */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImageFile(file);
            e.target.value = "";
          }}
        />

        {/* page overview */}
        <Dialog open={overviewOpen} onOpenChange={setOverviewOpen}>
          <DialogContent aria-describedby={undefined} className="max-h-[85dvh] sm:max-w-3xl bg-[#fffdf7]">
            <DialogHeader>
              <DialogTitle>Pages</DialogTitle>
            </DialogHeader>
            <div className="grid max-h-[62dvh] grid-cols-2 gap-4 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
              {pages.map((p, i) => (
                <PageThumb
                  key={p.id}
                  page={p}
                  index={i}
                  active={i === pageIndex}
                  onJump={() => {
                    goToPage(i);
                    setOverviewOpen(false);
                  }}
                  onToggleBookmark={() => void toggleBookmark(i)}
                />
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function PageThumb({
  page,
  index,
  active,
  onJump,
  onToggleBookmark,
}: {
  page: PageData;
  index: number;
  active: boolean;
  onJump: () => void;
  onToggleBookmark: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) void renderPage(canvas, page, 0.16);
  }, [page]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onJump}
        className={`relative block w-full overflow-hidden rounded-md border-2 bg-white shadow-sm transition-transform hover:-translate-y-0.5 ${
          active ? "border-[#c9973b] ring-2 ring-[#c9973b]/40" : "border-[#e2d7c2]"
        }`}
        aria-label={`Go to page ${index + 1}`}
        aria-current={active}
      >
        <canvas ref={canvasRef} className="block h-auto w-full" aria-hidden="true" />
        <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1.5 text-[10px] font-semibold text-white">
          {index + 1}
        </span>
      </button>
      <button
        onClick={onToggleBookmark}
        className="flex items-center gap-1 text-xs text-[#8a7457] hover:text-[#8a5a32]"
        aria-label={page.bookmarked ? "Remove bookmark" : "Bookmark page"}
        aria-pressed={page.bookmarked}
      >
        <Star className={`size-3.5 ${page.bookmarked ? "fill-[#e5b32e] text-[#e5b32e]" : ""}`} />
        {page.bookmarked ? "Bookmarked" : "Bookmark"}
      </button>
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  return (
    <span
      className={`ml-1 hidden text-[11px] font-medium transition-opacity sm:inline ${
        state === "idle" ? "opacity-0" : "opacity-80"
      }`}
      role="status"
    >
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}
    </span>
  );
}
