"use client";

import { useEffect } from "react";
import { useOpenNotes } from "@/lib/opennotes/store";
import { LibraryView } from "@/components/opennotes/library";
import { EditorView } from "@/components/opennotes/editor";
import { LogoMark } from "@/components/opennotes/logo";

export default function Home() {
  const ready = useOpenNotes((s) => s.ready);
  const view = useOpenNotes((s) => s.view);
  const init = useOpenNotes((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  // Register the service worker (production builds only) for offline use
  // and PWA installability on iPad / macOS / Windows.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline support unavailable — app still works online */
      });
    }
  }, []);

  if (!ready) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[#f3ede1]">
        <LogoMark size={64} />
        <div className="flex items-center gap-2 text-sm font-medium text-[#8a7457]">
          <span className="inline-block size-2 animate-pulse rounded-full bg-[#c9973b]" />
          Opening your notebooks…
        </div>
      </div>
    );
  }

  return view.name === "library" ? (
    <LibraryView />
  ) : (
    <EditorView key={view.notebookId} notebookId={view.notebookId} />
  );
}
