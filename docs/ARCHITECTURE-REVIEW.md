# Architecture Review — deep-module / decomposition campaign

Living pickup doc for the ongoing architecture-deepening pass. **Goal:** shrink the
`PlexState` god-object (`src/renderer/src/lib/plex-state.svelte.ts`) into small,
dependency-injected, individually-testable controllers, and build out a real test
suite along the way. Lens: Ousterhout deep modules + Matt-Pocock-style narrow seams.

Started 2026-05-25. The canonical "what shipped" record is `CHANGELOG.md`; this doc
is the **why / how / what's-next** for the campaign specifically.

---

## Current state (2026-05-25)

- **`PlexState`: 4812 → 1934 lines** since the decomposition began (−60%).
- **Test suite: 0 → 204 tests** (`npm run test`), across 14 controllers +
  `AlbumDetailLoader` + 3 shared modules (`guid`, `title-match`, `duplicates`).
- Every slice is typecheck-gated (`npm run typecheck` must be clean) and committed
  as soon as it's verified.

### Controllers extracted (in `src/renderer/src/lib/`)

| Controller | File | Owns | Tests |
|---|---|---|---|
| `SearchController` | `search-controller.svelte.ts` | library search: query, debounce, request-sequence guard | 6 |
| `PlaybackController` | `playback-controller.svelte.ts` | active player, timeline poll (backoff+visibility), cast intent dance, continuous-extender, transport, queue, volume | 18 |
| `SettingsController` | `settings-controller.svelte.ts` | settings modal: API keys + `continuousPlayback`, load-once + save-merge | 5 |
| `NavController` | `nav-controller.svelte.ts` | back/forward stacks: dedup, ring cap, pop/unpop/reset (dependency-free) | 8 |
| `EntityController` | `entity-controller.svelte.ts` | artist/person page: header, MB credited-works, in-library appearances, bio | 8 |
| `LyricsController` | `lyrics-controller.svelte.ts` | per-track lyrics: fetch cache + open panels, toggle + background album prefetch | 8 |
| `CoverArtController` | `cover-art-controller.svelte.ts` | cover overrides map (read by `thumbUrl`) + cover-picker modal: search/confirm/upload/clear | 14 |
| `ShowsController` | `shows-controller.svelte.ts` | shows-near-me: parallel venue scrape, library match (pure `buildArtistIndex`/`matchAgainstLibrary`), dedup, sort | 12 |
| `AlbumOfTheDayController` | `album-of-the-day-controller.svelte.ts` | deterministic daily pick (pure `seedIndex` FNV-1a + localStorage memo) | 6 |
| `LabelIndexController` | `label-index-controller.svelte.ts` | label map + indexer progress/backup + start/stop/retry/clear/restore (pure `albumToIndexItem`) | 10 |
| `SlskdController` | `slskd-controller.svelte.ts` | Soulseek client: config/health, paste-list search queue + prefetch memo cache + seq guard, MB release picker, `searchSoulseekFor`, downloads poll, post-apply `removeDownloadsByFolder` (pure `parseSlskdList`/`slskdCacheKey`) | 29 |
| `TriageController` | `triage-controller.svelte.ts` | library triage: flags/duplicates/mistagged modes, flag filters, MB track-count scan + cache, mistagged audit + one-click repair, persisted dup-dismissals/reviewed-albums (pure dup logic in `src/shared/duplicates.ts`) | 12 |
| `InboxController` | `inbox-controller.svelte.ts` | slskd-download inbox/tagger: folder list + health, open-folder MB-match (shared `ReleaseMatcher`) + fingerprint, pick→preview→apply reconciler + inflow guard, post-apply slskd cleanup (pure `pickBestCandidate`/`guessCommonTag`/`decisionsFromPreview`) | 19 |

Plus `AlbumDetailLoader` (`album-detail-loader.svelte.ts`) — the per-album cascade
(album/credits/bio/booklet) now also owns the **label rail + similar-artists rail**
for its scope (10 tests; library list / label index / artist-relation IPC injected
as deps) — and the pre-existing `FilterState`, and the shared pure modules
`src/shared/guid.ts` + `src/shared/title-match.ts` (27 tests).

### Convention

- Components read `plexState.<controller>.*` (e.g. `plexState.playback.timeline`,
  `plexState.settings.continuousPlayback`, `plexState.entityPage.entity`).
- Each controller takes a `…Deps` object in its constructor: context getters
  (`session()`), callbacks (`flashToast`, `onAlbumCast`), and IPC namespaces
  (`plex`, `mediaKeys`, `settings`) that **default to `window.cratedigger.*` but are
  injectable**, so tests run against stubs with no Electron bridge / live server.
- View orchestration that spans concerns stays on `PlexState` (e.g. `openEntity`
  clears overlays + pushes nav, then calls `entityPage.load()`); the controller owns
  the self-contained logic.
- Cross-cutting helpers stay on `PlexState` and are injected down: the toast helper
  (`flashToast`/`castToast` — used by ~44 non-playback sites) and the
  `continuousPlayback` setting (owned by `SettingsController`, read by playback).

---

## What's left

**All the low/medium-risk peripheral controllers are extracted.** What remains on
`PlexState` is either genuinely cross-cutting view orchestration (nav dispatch,
`view` flipping, the modal-open flags, top-level `init`/`dispose`, `thumbUrl`,
`selectSection`/`loadMoreAlbums`/sort, the `ensureAllAlbums` library cache) — which
is the right home for it — or the high-risk tagging core below.

**The tagging core is fully decomposed — the campaign's planned work is done.**
`Slskd` → `Triage` → `Inbox` all **landed 2026-05-25** with explicit user
go-ahead (the merge-album modal flow `mergeState` was dropped from scope —
feature retired). `PlexState` is down to ~1.9k LoC (from 4.8k).

What remains on `PlexState` is the right home for it:

- **Cross-cutting view orchestration**: nav dispatch, `view` flipping, the
  modal-open flags, `init`/`dispose`, `thumbUrl`, `selectSection`/`loadMoreAlbums`/
  sort, the `ensureAllAlbums` library cache, and the thin `open*`/`close*` view
  wrappers that delegate into the controllers.
- **Deliberately kept (do not extract)**: `deleteAlbumFromLibrary` + `deletedAlbums`
  (shared with `AlbumDetail`, mutate core library caches); the retired
  merge-album modal flow (`mergeState`).

**Next candidate (optional, fresh slice — not tagging):** the album-card
media-info subsystem (`albumMediaInfo` + the `requestAlbumMediaInfo`/
`pumpMediaInfoQueue` trickle-fetcher + `runMediaScanForDuplicates`) is a
self-contained library-wide concern that could become a `MediaInfoController`.
It was deliberately left in place during the Triage slice (Triage only reads it).

**Done:**
- ~~Relocate label-rail / similar-artists into `AlbumDetailLoader`~~ — landed
  2026-05-25. Both rails (state + the whole-library/MB-relation logic) moved onto
  the two loader instances; deps (`ensureAllAlbums`, `albumLabels`, `session`,
  plex/tagger IPC) injected; 10 tests. The loader's `clear()` now also resets its
  rails, and `resetRails()` is public for the now-playing per-track refresh.
- ~~`LyricsController`~~ — landed 2026-05-25. Per-track lyrics cache + open
  panels + toggle/prefetch. Cache persists for the session; only open panels
  reset on album close (`closeAll`, which also replaced the dead `closeAllLyrics`).
  Prefetch's bail-on-navigate guard reads the open album's ratingKey via an
  injected getter; Plex IPC injectable; 8 tests.
- ~~`CoverArtController`~~ — landed 2026-05-25. The override map (`overrides`,
  read by `thumbUrl`) + the picker modal (`picker`) + search/confirm/upload/clear.
  Toast helper + Plex IPC injected. `coverArt.load()` replaces the old
  `loadCoverOverrides` in `init()`; 14 tests.
- ~~`ShowsController`~~ — landed 2026-05-25. Parallel venue scrape + library
  cross-reference + dedup + sort. `buildArtistIndex`/`matchAgainstLibrary`
  exported as pure functions (tested directly). `openShows`/`closeShows` stay on
  PlexState (they flip `view`) and call `shows.run()`; the cache-busting library
  refresh is injected as `refreshAllAlbums`. 12 tests.
- ~~`AlbumOfTheDayController`~~ — landed 2026-05-25. Deterministic daily pick;
  `seedIndex` (FNV-1a) exported as a pure function (tested directly). Library
  list + active section injected. 6 tests.
- ~~`LabelIndexController`~~ — landed 2026-05-25. Label map + indexer progress +
  backup count + start/stop/retry/clear/restore + its own progress-event
  subscription. `albumToIndexItem` exported as a pure function (tested directly).
  Library list, label-filter reset, and Plex IPC injected; the loader's
  `albumLabels()` dep getter now points at `labelIndex.labels`. 10 tests.
  `labelFilterOpen` + `openLabelFilter`/`closeLabelFilter` stayed on PlexState
  (modal-open view flag, like the other filter toggles).

---

## The recipe (what's worked)

For a big/entangled controller, split into **two commits**:

1. **Extract + forward.** Create the controller; `PlexState` instantiates it and
   *forwards* its public API (getters + delegating methods). Behaviour identical,
   component call sites untouched, typecheck clean — a low-risk checkpoint (used for
   `PlaybackController`).
2. **Migrate + drop forwards.** Repoint component call sites to
   `plexState.<controller>.*` and delete the forwards.

For small/clean controllers (Settings, Nav, Entity), do it in one commit.

**Sequence inside a slice:**
1. Read the full surface; map internal `this.X` uses *and* component `plexState.X`
   uses before cutting (so you don't break an internal caller when forwards are dropped).
2. Write the controller with injected deps; transcribe method bodies near-verbatim.
   Preserve behaviour exactly — even quirks (e.g. `#loadCredited` deliberately has no
   request guard, matching the original). Note the quirk in a comment.
3. Wire `PlexState`: import + instantiate, slim/remove the moved methods, rewire
   internal references, repoint any cross-controller deps.
4. Migrate component call sites; clean up now-dead imports.
5. `npm run typecheck` (the checklist — every missed rename is an error) → `npm run test`.
6. Write unit tests for the controller's real logic. Commit. Update CHANGELOG.

---

## Gotchas / mechanics

- **Rune-aware vitest is wired** (`vitest.config.ts`): `@sveltejs/vite-plugin-svelte`
  + `resolve.conditions:['browser']` (gated on `mode==='test'`). `.svelte.ts`
  controllers compile and `$state`/`$derived` work under test. **No jsdom** — `$state`
  proxies run in node.
- **Timers:** use bare `setTimeout` (not `window.setTimeout`) so controllers run in
  node; type timer fields `ReturnType<typeof setTimeout> | null`. In tests use
  `vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout'] })` so `Date.now()` stays
  real (the continuous-extender + volume throttle compare against it).
- **Reactivity through getters:** components reading `plexState.playback.timeline`
  track the controller's `$state` signal at access time — forwarding/nesting is
  reactively sound (same pattern as `plexState.search.*`).
- **Call-site migration:** `perl -i -pe 's/\bplexState\.OLD\b/plexState.ctrl.NEW/g'`,
  alternation ordered **longest-first** so `activePlayer` doesn't clobber
  `activePlayerName`. **Pipe the file list via `xargs`** — zsh does *not* word-split a
  bare `$var` in a `for` loop (silent no-op if you do).
- **Harness read-cache:** `perl -i`/`sed -i` edits modify files on disk, which
  invalidates the Edit tool's "last read" tracking — **re-Read a region before the
  next `Edit`** after a shell edit.
- **Concurrency:** an Antigravity agent has been committing to this repo in parallel
  (mobile app, mostly `cratedigger_mobile/` + occasional `plex-state` touches). It
  hasn't collided, but commit each verified slice promptly and keep an eye on
  `git log` / `git status`.

See also the assistant memory `project_arch_deepening_campaign` for the same history
with commit hashes.
