"use client";
/**
 * Global app state (Zustand): view routing, notebooks list, user settings.
 * Page element data deliberately lives in the InkEngine + IndexedDB,
 * not in React state — it changes at pointer-event frequency.
 */
import { create } from "zustand";
import * as db from "./db";
import { uid, type NotebookMeta, type PaperTemplate } from "./types";

export type View = { name: "library" } | { name: "editor"; notebookId: string };

interface OpenNotesState {
  ready: boolean;
  view: View;
  notebooks: NotebookMeta[];
  palmRejection: boolean;
  fingerDrawing: boolean;
  savedAt: number | null;

  init: () => Promise<void>;
  openLibrary: () => void;
  openNotebook: (id: string) => void;

  createNotebook: (title: string, coverColor: number, template: PaperTemplate) => Promise<string>;
  createNotebookFromPdf: (
    title: string,
    coverColor: number,
    backgrounds: string[]
  ) => Promise<string>;
  duplicateNotebook: (id: string) => Promise<void>;
  renameNotebook: (id: string, title: string) => Promise<void>;
  setNotebookCover: (id: string, coverColor: number) => Promise<void>;
  removeNotebook: (id: string) => Promise<void>;
  refreshNotebook: (id: string, pageCountDelta?: number) => Promise<void>;

  setPalmRejection: (v: boolean) => void;
  setFingerDrawing: (v: boolean) => void;
  setSavedNow: () => void;
}

const SETTINGS_KEY = "opennotes.settings";

function loadSettings(): { palmRejection: boolean; fingerDrawing: boolean } {
  if (typeof localStorage === "undefined") return { palmRejection: true, fingerDrawing: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        palmRejection: parsed.palmRejection ?? true,
        fingerDrawing: parsed.fingerDrawing ?? false,
      };
    }
  } catch {
    /* ignore corrupt settings */
  }
  return { palmRejection: true, fingerDrawing: false };
}

export const useOpenNotes = create<OpenNotesState>((set, get) => ({
  ready: false,
  view: { name: "library" },
  notebooks: [],
  palmRejection: true,
  fingerDrawing: false,
  savedAt: null,

  init: async () => {
    const settings = loadSettings();
    try {
      const notebooks = await db.listNotebooks();
      if (notebooks.length === 0) {
        await seedWelcomeNotebook();
        set({ notebooks: await db.listNotebooks() });
      } else {
        set({ notebooks });
      }
    } catch {
      // IndexedDB unavailable (private mode etc.) — app still works, just won't persist.
      set({ notebooks: [] });
    }
    set({ ready: true, ...settings });
  },

  openLibrary: () => set({ view: { name: "library" } }),
  openNotebook: (id) => set({ view: { name: "editor", notebookId: id } }),

  createNotebook: async (title, coverColor, template) => {
    const id = uid("nb");
    const now = Date.now();
    const meta: NotebookMeta = {
      id,
      title: title.trim() || "Untitled notebook",
      coverColor,
      pageCount: 1,
      createdAt: now,
      updatedAt: now,
    };
    await db.putNotebook(meta);
    await db.putPage({
      id: uid("pg"),
      notebookId: id,
      index: 0,
      template,
      elements: [],
      updatedAt: now,
    });
    set({ notebooks: await db.listNotebooks() });
    return id;
  },

  createNotebookFromPdf: async (title, coverColor, backgrounds) => {
    const id = uid("nb");
    const now = Date.now();
    const meta: NotebookMeta = {
      id,
      title: title.trim() || "Imported PDF",
      coverColor,
      pageCount: Math.max(1, backgrounds.length),
      createdAt: now,
      updatedAt: now,
    };
    await db.putNotebook(meta);
    const pages: import("./types").PageData[] = backgrounds.map((background, index) => ({
      id: uid("pg"),
      notebookId: id,
      index,
      template: "blank" as PaperTemplate,
      elements: [],
      background,
      updatedAt: now,
    }));
    if (pages.length === 0) {
      pages.push({
        id: uid("pg"),
        notebookId: id,
        index: 0,
        template: "blank",
        elements: [],
        updatedAt: now,
      });
    }
    for (const p of pages) await db.putPage(p);
    set({ notebooks: await db.listNotebooks() });
    return id;
  },

  duplicateNotebook: async (id) => {
    const src = get().notebooks.find((n) => n.id === id);
    if (!src) return;
    const now = Date.now();
    const newId = uid("nb");
    const meta: NotebookMeta = {
      ...src,
      id: newId,
      title: `${src.title} copy`,
      createdAt: now,
      updatedAt: now,
    };
    const pages = await db.listPages(id);
    await db.putNotebook(meta);
    for (const p of pages) {
      await db.putPage({
        ...p,
        id: uid("pg"),
        notebookId: newId,
        updatedAt: now,
      });
    }
    set({ notebooks: await db.listNotebooks() });
  },

  renameNotebook: async (id, title) => {
    const nb = get().notebooks.find((n) => n.id === id);
    if (!nb) return;
    const updated = { ...nb, title: title.trim() || nb.title, updatedAt: Date.now() };
    await db.putNotebook(updated);
    set({ notebooks: await db.listNotebooks() });
  },

  setNotebookCover: async (id, coverColor) => {
    const nb = get().notebooks.find((n) => n.id === id);
    if (!nb) return;
    const updated = { ...nb, coverColor, updatedAt: Date.now() };
    await db.putNotebook(updated);
    set({ notebooks: await db.listNotebooks() });
  },

  removeNotebook: async (id) => {
    await db.deleteNotebook(id);
    set({ notebooks: await db.listNotebooks() });
  },

  refreshNotebook: async (id, pageCountDelta = 0) => {
    const nb = get().notebooks.find((n) => n.id === id);
    if (!nb) return;
    const updated = {
      ...nb,
      pageCount: Math.max(1, nb.pageCount + pageCountDelta),
      updatedAt: Date.now(),
    };
    await db.putNotebook(updated);
    set({ notebooks: await db.listNotebooks() });
  },

  setPalmRejection: (v) => {
    set({ palmRejection: v });
    persistSettings(get());
  },
  setFingerDrawing: (v) => {
    set({ fingerDrawing: v });
    persistSettings(get());
  },
  setSavedNow: () => set({ savedAt: Date.now() }),
}));

function persistSettings(s: OpenNotesState): void {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ palmRejection: s.palmRejection, fingerDrawing: s.fingerDrawing })
    );
  } catch {
    /* ignore */
  }
}

/* ------------------------------- welcome seed -------------------------------- */

/**
 * A hand-crafted welcome notebook so the library never opens empty.
 * The "handwriting" is synthesized stroke data (a smiley + hello scribble)
 * so users immediately see the ink engine working.
 */
async function seedWelcomeNotebook(): Promise<void> {
  const now = Date.now();
  const meta: NotebookMeta = {
    id: uid("nb"),
    title: "Welcome to OpenNotes",
    coverColor: 0,
    pageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.putNotebook(meta);
  await db.putPage({
    id: uid("pg"),
    notebookId: meta.id,
    index: 0,
    template: "dotted",
    elements: welcomeStrokes().map((s) => ({ ...s, kind: "stroke" as const })),
    updatedAt: now,
  });
}

function welcomeStrokes(): import("./types").Stroke[] {
  const strokes: import("./types").Stroke[] = [];
  let sid = 0;
  const mk = (color: string, size: number, pts: [number, number][], tool: "pen" | "highlighter" = "pen") => {
    const t0 = sid * 1000;
    strokes.push({
      id: `seed_${sid++}`,
      tool,
      color,
      size,
      hasRealPressure: false,
      points: pts.map(([x, y], i) => ({
        x,
        y,
        p: 0.55 + 0.25 * Math.sin(i / 6),
        t: t0 + i * 12,
      })),
    });
  };

  // smiley face
  const cx = 620;
  const cy = 430;
  const face: [number, number][] = [];
  for (let a = -Math.PI * 0.42; a <= Math.PI * 1.42; a += 0.12) {
    face.push([cx + Math.cos(a) * 120, cy + Math.sin(a) * 120]);
  }
  mk("#1f1b16", 7, face);
  const eyeL: [number, number][] = [];
  for (let a = Math.PI * 0.15; a <= Math.PI * 0.85; a += 0.2) {
    eyeL.push([cx - 45 + Math.cos(a) * 16, cy - 30 + Math.sin(a) * 20]);
  }
  const eyeR: [number, number][] = [];
  for (let a = Math.PI * 0.15; a <= Math.PI * 0.85; a += 0.2) {
    eyeR.push([cx + 45 + Math.cos(a) * 16, cy - 30 + Math.sin(a) * 20]);
  }
  mk("#1f1b16", 7, eyeL);
  mk("#1f1b16", 7, eyeR);
  const mouth: [number, number][] = [];
  for (let a = 0.25; a <= Math.PI - 0.25; a += 0.18) {
    mouth.push([cx + Math.cos(a) * 60, cy + 18 + Math.sin(a) * 42]);
  }
  mk("#1f1b16", 7, mouth);

  // "hello" underline swoosh
  const swoosh: [number, number][] = [];
  for (let x = 300; x <= 940; x += 14) {
    swoosh.push([x, 660 + Math.sin((x - 300) / 90) * 9]);
  }
  mk("#d6453d", 9, swoosh);

  // a highlighter swipe under the swoosh
  const swipe: [number, number][] = [];
  for (let x = 320; x <= 900; x += 20) {
    swipe.push([x, 720]);
  }
  mk("#e5b32e", 30, swipe, "highlighter");

  return strokes;
}
