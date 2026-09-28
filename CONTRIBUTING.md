# Contributing to OpenNotes

First off, thanks for spending time on this project — every PR makes
handwritten notes a little more free for everyone.

## Ways to contribute

- **Bug reports** — something drawing wrong, data not saving, layout broken on your device
- **Feature work** — check the [roadmap](./ROADMAP.md) or propose your own idea
- **Ink quality** — smoothing, pressure curves, latency: the heart of the app
- **Platform testing** — iPad + Apple Pencil reports are especially valuable
- **Docs & translations** — clarity is a feature too

## Development setup

```bash
git clone https://github.com/<your-org>/opennotes.git
cd opennotes
bun install        # or npm install / pnpm install
bun run dev        # http://localhost:3000
```

Before opening a PR:

```bash
bun run lint       # must pass with no errors
bun run build      # must compile
```

## Project conventions

- **TypeScript strict** — no `any` unless you truly have no other option
- **One responsibility per module** — the ink engine (`ink-engine.ts`) knows
  nothing about React; the UI knows nothing about canvas math
- **Plain, serializable data** — the data model in `types.ts` must stay
  JSON-compatible so notebooks can be exported/backed up
- **No new heavy dependencies** without discussion — the app should stay
  lean enough to load instantly on a first-gen iPad
- **Warm, paper-inspired UI** — keep the cream/leather palette; avoid
  introducing new design languages

## Testing your changes

There is no automated test suite yet (contributions welcome!). For now,
please manually verify at minimum:

1. Draw with mouse — smooth, tapered strokes
2. Pen / highlighter / both erasers / laser — switch and draw with each
3. Undo/redo across draw + erase operations
4. Create a notebook, add a page, reload the browser — data persists
5. Export PNG and PDF — no console errors
6. Window resize and a narrow (390px) viewport — layout holds

## Commit & PR style

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- One logical change per PR; include before/after screenshots for UI work
- Describe **how to reproduce** the issue you are fixing

## Reporting bugs

Open a [bug report](.github/ISSUE_TEMPLATE/bug_report.yml) and include:
your device + browser (e.g. iPad Air, iPadOS 17.5, Safari), whether a
stylus was used, and steps to reproduce.
