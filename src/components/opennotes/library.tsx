"use client";

import { useMemo, useRef, useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  Palette,
  Plus,
  Search,
  Trash2,
  FolderOpen,
  FileUp,
  Copy,
  Loader2,
} from "lucide-react";
import { useOpenNotes } from "@/lib/opennotes/store";
import { COVER_COLORS, type PaperTemplate } from "@/lib/opennotes/types";
import { PAPER_TEMPLATES } from "@/lib/opennotes/paper";
import { renderPdfToBackgrounds } from "@/lib/opennotes/pdf-import";
import { LogoMark, NotebookCover } from "./logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(ts).toLocaleDateString();
}

export function LibraryView() {
  const notebooks = useOpenNotes((s) => s.notebooks);
  const createNotebook = useOpenNotes((s) => s.createNotebook);
  const createNotebookFromPdf = useOpenNotes((s) => s.createNotebookFromPdf);
  const duplicateNotebook = useOpenNotes((s) => s.duplicateNotebook);
  const renameNotebook = useOpenNotes((s) => s.renameNotebook);
  const setNotebookCover = useOpenNotes((s) => s.setNotebookCover);
  const removeNotebook = useOpenNotes((s) => s.removeNotebook);
  const openNotebook = useOpenNotes((s) => s.openNotebook);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newColor, setNewColor] = useState(0);
  const [newTemplate, setNewTemplate] = useState<PaperTemplate>("dotted");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // PDF import flow
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfColor, setPdfColor] = useState(1);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notebooks;
    return notebooks.filter((n) => n.title.toLowerCase().includes(q));
  }, [notebooks, query]);

  const handleCreate = async () => {
    const id = await createNotebook(newTitle || "Untitled notebook", newColor, newTemplate);
    setCreateOpen(false);
    setNewTitle("");
    setNewColor(0);
    openNotebook(id);
  };

  const handlePdfPicked = (file: File | undefined) => {
    if (!file) return;
    setPdfFile(file);
    setPdfTitle(file.name.replace(/\.pdf$/i, ""));
    setPdfProgress(null);
  };

  const handlePdfImport = async () => {
    if (!pdfFile) return;
    setPdfProgress({ done: 0, total: 1 });
    try {
      const backgrounds = await renderPdfToBackgrounds(pdfFile, (done, total) =>
        setPdfProgress({ done, total })
      );
      const id = await createNotebookFromPdf(
        pdfTitle || pdfFile.name.replace(/\.pdf$/i, ""),
        pdfColor,
        backgrounds
      );
      setPdfFile(null);
      setPdfTitle("");
      openNotebook(id);
    } catch {
      setPdfProgress(null);
      // keep the dialog open so the user can retry or cancel
    }
  };

  const deleteTargetName = notebooks.find((n) => n.id === deleteTarget)?.title ?? "";

  return (
    <div className="min-h-dvh bg-[#f3ede1] text-[#3b2f21]">
      {/* header */}
      <header className="sticky top-0 z-10 bg-[#8a5a32] text-[#fdf9f0] shadow-md">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center gap-3">
          <LogoMark size={34} />
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight tracking-tight">OpenNotes</h1>
            <p className="text-[11px] text-[#e8d9c2] leading-none hidden sm:block">
              Your paper, your device — free & open source
            </p>
          </div>
          <div className="flex-1" />
          <div className="relative hidden sm:block w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-[#e8d9c2]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notebooks"
              aria-label="Search notebooks"
              className="pl-8 h-9 bg-white/15 border-white/20 text-[#fdf9f0] placeholder:text-[#e8d9c2]/70 focus-visible:ring-white/40"
            />
          </div>
          <Button
            onClick={() => pdfInputRef.current?.click()}
            className="h-9 gap-1.5 bg-white/15 text-[#fdf9f0] hover:bg-white/25 font-semibold shadow-sm"
            aria-label="Import PDF"
          >
            <FileUp className="size-4" />
            <span className="hidden md:inline">Import PDF</span>
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-9 gap-1.5 bg-[#fdf9f0] text-[#7c4e28] hover:bg-white font-semibold shadow-sm"
          >
            <Plus className="size-4" />
            <span className="hidden xs:inline sm:inline">New notebook</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <div className="size-20 rounded-2xl bg-white shadow-sm flex items-center justify-center">
              <FolderOpen className="size-9 text-[#b09468]" />
            </div>
            <div>
              <p className="font-semibold text-lg">No notebooks yet</p>
              <p className="text-sm text-[#8a7457] mt-1">
                {query ? "Nothing matches your search." : "Create your first notebook to start writing."}
              </p>
            </div>
            {!query && (
              <Button
                onClick={() => setCreateOpen(true)}
                className="gap-1.5 bg-[#8a5a32] hover:bg-[#7c4e28] text-white"
              >
                <Plus className="size-4" /> New notebook
              </Button>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {filtered.map((nb) => (
              <li key={nb.id} className="group">
                <button
                  onClick={() => openNotebook(nb.id)}
                  className="block w-full text-left rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#8a5a32] transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  <NotebookCover colorIndex={nb.coverColor} title={nb.title} pageCount={nb.pageCount} />
                </button>
                <div className="mt-2.5 flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" title={nb.title}>
                      {nb.title}
                    </p>
                    <p className="text-xs text-[#8a7457]">
                      {nb.pageCount} page{nb.pageCount === 1 ? "" : "s"} · {timeAgo(nb.updatedAt)}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-[#8a7457]"
                        aria-label={`Options for ${nb.title}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameTarget(nb.id);
                          setRenameValue(nb.title);
                        }}
                      >
                        <Pencil className="size-4" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setNotebookCover(nb.id, (nb.coverColor + 1) % COVER_COLORS.length)}
                      >
                        <Palette className="size-4" /> Change cover
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void duplicateNotebook(nb.id)}>
                        <Copy className="size-4" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-700"
                        onClick={() => setDeleteTarget(nb.id)}
                      >
                        <Trash2 className="size-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* hidden PDF input */}
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          handlePdfPicked(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {/* create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md bg-[#fffdf7]">
          <DialogHeader>
            <DialogTitle>New notebook</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label htmlFor="nb-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="nb-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Linear algebra — Semester 2"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Cover</p>
              <div className="flex gap-2.5" role="radiogroup" aria-label="Cover color">
                {COVER_COLORS.map((c, i) => (
                  <button
                    key={c.name}
                    role="radio"
                    aria-checked={newColor === i}
                    aria-label={c.name}
                    onClick={() => setNewColor(i)}
                    className={`size-8 rounded-full transition-transform ${
                      newColor === i ? "ring-2 ring-offset-2 ring-[#5b4a35] scale-110" : "hover:scale-105"
                    }`}
                    style={{ background: `linear-gradient(145deg, ${c.light}, ${c.base})` }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Paper</p>
              <div className="grid grid-cols-4 gap-2">
                {PAPER_TEMPLATES.map((t) => (
                  <PaperPreview
                    key={t.id}
                    template={t.id}
                    label={t.label}
                    selected={newTemplate === t.id}
                    onSelect={() => setNewTemplate(t.id)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} className="bg-[#8a5a32] hover:bg-[#7c4e28] text-white">
              Create notebook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PDF import dialog */}
      <Dialog
        open={pdfFile !== null}
        onOpenChange={(v) => {
          if (!v && !pdfProgress) setPdfFile(null);
        }}
      >
        <DialogContent aria-describedby={undefined} className="sm:max-w-md bg-[#fffdf7]">
          <DialogHeader>
            <DialogTitle>Import PDF</DialogTitle>
          </DialogHeader>
          {pdfProgress ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="size-8 animate-spin text-[#8a5a32]" />
              <p className="text-sm font-medium">
                Rendering page {pdfProgress.done} of {pdfProgress.total}…
              </p>
              <p className="text-xs text-[#8a7457]">Large PDFs can take a moment.</p>
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <p className="text-sm text-[#6b5844]">
                Every page becomes a fixed sheet you can annotate with ink, text and images.
                Everything stays on this device.
              </p>
              <div className="space-y-1.5">
                <label htmlFor="pdf-title" className="text-sm font-medium">
                  Notebook title
                </label>
                <Input
                  id="pdf-title"
                  value={pdfTitle}
                  onChange={(e) => setPdfTitle(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handlePdfImport();
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Cover</p>
                <div className="flex gap-2.5" role="radiogroup" aria-label="Cover color">
                  {COVER_COLORS.map((c, i) => (
                    <button
                      key={c.name}
                      role="radio"
                      aria-checked={pdfColor === i}
                      aria-label={c.name}
                      onClick={() => setPdfColor(i)}
                      className={`size-8 rounded-full transition-transform ${
                        pdfColor === i ? "ring-2 ring-offset-2 ring-[#5b4a35] scale-110" : "hover:scale-105"
                      }`}
                      style={{ background: `linear-gradient(145deg, ${c.light}, ${c.base})` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                if (!pdfProgress) setPdfFile(null);
              }}
              disabled={pdfProgress !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handlePdfImport()}
              className="bg-[#8a5a32] hover:bg-[#7c4e28] text-white"
              disabled={pdfProgress !== null}
            >
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* rename dialog */}
      <Dialog open={renameTarget !== null} onOpenChange={(v) => !v && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm bg-[#fffdf7]">
          <DialogHeader>
            <DialogTitle>Rename notebook</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            aria-label="Notebook title"
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameTarget) {
                renameNotebook(renameTarget, renameValue);
                setRenameTarget(null);
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-[#8a5a32] hover:bg-[#7c4e28] text-white"
              onClick={() => {
                if (renameTarget) renameNotebook(renameTarget, renameValue);
                setRenameTarget(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-[#fffdf7]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete notebook?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTargetName}” and all of its pages will be permanently removed from this device.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                if (deleteTarget) removeNotebook(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PaperPreview({
  template,
  label,
  selected,
  onSelect,
}: {
  template: PaperTemplate;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      className={`rounded-lg border p-1 flex flex-col items-center gap-1 transition-colors ${
        selected ? "border-[#8a5a32] ring-1 ring-[#8a5a32] bg-[#f7efe2]" : "border-[#e2d7c2] hover:bg-[#f7efe2]"
      }`}
    >
      <svg viewBox="0 0 40 52" className="w-full rounded bg-[#fdfbf5] border border-[#eee4d0]" aria-hidden="true">
        {template === "lined" &&
          [12, 20, 28, 36, 44].map((y) => (
            <line key={y} x1="6" y1={y} x2="34" y2={y} stroke="#d9cfc0" strokeWidth="1" />
          ))}
        {template === "grid" &&
          [10, 18, 26, 34, 42].flatMap((y) =>
            [8, 16, 24, 32].map((x) => (
              <line key={`${x}-${y}`} x1={x} y1={y - 6} x2={x} y2={y + 6} stroke="#e5dcc9" strokeWidth="1" />
            ))
          )}
        {template === "dotted" &&
          [10, 20, 30, 40].flatMap((y) =>
            [10, 20, 30].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" fill="#c9bda9" />)
          )}
      </svg>
      <span className="text-[10px] font-medium text-[#6b5844]">{label}</span>
    </button>
  );
}
