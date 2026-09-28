/**
 * Local-first persistence on IndexedDB.
 * - `notebooks` store: notebook metadata
 * - `pages` store: one record per page (template + strokes)
 *
 * No server, no account — data never leaves the device.
 */

const DB_NAME = "opennotes";
const DB_VERSION = 1;
const NOTEBOOKS = "notebooks";
const PAGES = "pages";

import type { NotebookMeta } from "./types";
import { normalizePage, type PageData } from "./types";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(NOTEBOOKS)) {
          db.createObjectStore(NOTEBOOKS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(PAGES)) {
          const pages = db.createObjectStore(PAGES, { keyPath: "id" });
          pages.createIndex("byNotebook", "notebookId");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    });
  }
  return dbPromise;
}

function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => IDBRequest<T> | void
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let request: IDBRequest<T> | void;
        t.oncomplete = () => resolve(request ? request.result : (undefined as unknown as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error("Transaction aborted"));
        request = run(t);
      })
  );
}

/* ---------------------------------- notebooks --------------------------------- */

export async function listNotebooks(): Promise<NotebookMeta[]> {
  const rows = await tx<NotebookMeta[]>([NOTEBOOKS], "readonly", (t) =>
    t.objectStore(NOTEBOOKS).getAll()
  );
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putNotebook(meta: NotebookMeta): Promise<void> {
  await tx([NOTEBOOKS], "readwrite", (t) => t.objectStore(NOTEBOOKS).put(meta));
}

export async function deleteNotebook(id: string): Promise<void> {
  const pageIds = await tx<IDBValidKey[]>([PAGES], "readonly", (t) =>
    t.objectStore(PAGES).index("byNotebook").getAllKeys(id)
  );
  await tx([NOTEBOOKS, PAGES], "readwrite", (t) => {
    t.objectStore(NOTEBOOKS).delete(id);
    const store = t.objectStore(PAGES);
    for (const pid of pageIds) store.delete(pid);
  });
}

/* ------------------------------------ pages ----------------------------------- */

export async function listPages(notebookId: string): Promise<PageData[]> {
  const rows = await tx<PageData[]>([PAGES], "readonly", (t) =>
    t.objectStore(PAGES).index("byNotebook").getAll(notebookId)
  );
  // normalize legacy v1 records (strokes-only) into the elements model
  return rows.sort((a, b) => a.index - b.index).map((p) => normalizePage(p as never));
}

export async function putPage(page: PageData): Promise<void> {
  await tx([PAGES], "readwrite", (t) => t.objectStore(PAGES).put(page));
}

export async function deletePage(pageId: string): Promise<void> {
  await tx([PAGES], "readwrite", (t) => t.objectStore(PAGES).delete(pageId));
}
