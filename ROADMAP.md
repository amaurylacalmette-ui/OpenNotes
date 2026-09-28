# Roadmap

OpenNotes is a young project. This roadmap is a living document — argue
with it in issues and PRs.

## v1.x — polish the paper experience ✅ (shipped in 2.0)

- [x] Text boxes with local fonts and reflow
- [x] Shape recognition: draw rough, snap to perfect (ellipse, line, rectangle, triangle)
- [x] Selection lasso: move and duplicate ink, text and images
- [x] Page management UI: overview grid with jump-to-page and bookmarks
- [x] Insert images; place and resize on the page
- [x] Import PDF and annotate on top (the classic GoodNotes flow)
- [ ] Notebook cover thumbnails that preview page 1 ink
- [ ] Dark UI theme (paper stays light, chrome goes dark)
- [ ] Autosave status improvements + storage quota indicator
- [ ] Unit tests for ink geometry (hit-testing, splitting, history ops)
- [ ] Arrow shape + quadrilateral snapping refinement
- [ ] Reorder, duplicate and insert pages between existing pages

## v2 — richer notebooks

- [ ] Image crop & rotate on the page
- [ ] Audio notes pinned to a page location
- [ ] Hyperlinks between pages and notebooks
- [ ] Folders, tags and full-text search
- [ ] Custom paper templates (import your own PNG)

## v3 — share and sync (without a server you don't control)

- [ ] `.opennotes` single-file export/import format
- [ ] Optional end-to-end encrypted sync, bring-your-own backend
  (WebDAV / S3 / Supabase adapters)
- [ ] Collaborative cursors over WebRTC (local-network first)
- [ ] Read-only share links

## Platform

- [ ] Optional Electron/Tauri wrappers for native Mac/Windows builds
- [ ] App Store / Microsoft Store distribution guides
- [ ] Apple Pencil double-tap gestures (switch eraser/pen)
- [ ] Pen barrel-button erase

## Under consideration

- [ ] Plugin API for community tools
- [ ] OCR handwriting search (on-device, e.g. WASM models)
- [ ] Presentation mode with the laser pointer front and center
